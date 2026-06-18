#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_NAME="esimker"
NGINX_CONF="/etc/nginx/sites-available/${PROJECT_NAME}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${PROJECT_NAME}.conf"
NGINX_WEBHOOK_CONF="/etc/nginx/sites-available/${PROJECT_NAME}-webhook.conf"
NGINX_WEBHOOK_LINK="/etc/nginx/sites-enabled/${PROJECT_NAME}-webhook.conf"
NGINX_PANEL_CONF="/etc/nginx/sites-available/${PROJECT_NAME}-panel.conf"
NGINX_PANEL_LINK="/etc/nginx/sites-enabled/${PROJECT_NAME}-panel.conf"
CERTBOT_WEBROOT="/var/www/certbot"
DEFAULT_HTTP_PORT=8080
DEFAULT_PANEL_HTTP_PORT=8081
DEFAULT_SSL_PORT=443

GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RED=$'\033[0;31m'
NC=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'

log_info()    { echo -e "${CYAN}$1${NC}"; }
log_warn()    { echo -e "${YELLOW}$1${NC}"; }
log_success() { echo -e "${GREEN}$1${NC}"; }
log_error()   { echo -e "${RED}$1${NC}" >&2; }

on_error() {
    log_error "Ошибка на строке $1. Установка прервана."
}
trap 'on_error $LINENO' ERR

REPO_URL="${ESIMKER_REPO_URL:-https://github.com/Blin4ickUSE/esimker.git}"
GIT_BRANCH="${ESIMKER_GIT_BRANCH:-main}"
DEFAULT_INSTALL_DIR="${ESIMKER_INSTALL_DIR:-/opt/esimker}"

# curl … | bash передаёт скрипт через pipe; BASH_SOURCE[0] часто /dev/fd/N, а не "bash".
is_piped_script() {
    local source="${BASH_SOURCE[0]:-}"
    [[ -z "$source" || "$source" == "bash" ]] && return 0
    [[ "$source" == /dev/fd/* || "$source" == /proc/self/fd/* ]] && return 0
    [[ ! -f "$source" ]] && return 0
    return 1
}

should_sync_from_github() {
    is_piped_script
}

resolve_project_dir() {
    local source="${BASH_SOURCE[0]:-}"
    if [[ -n "$source" && "$source" != "bash" && -f "$source" ]]; then
        local dir
        dir="$(cd "$(dirname "$source")" && pwd)"
        if [[ -f "$dir/docker-compose.yml" ]]; then
            echo "$dir"
            return
        fi
    fi
    echo "$DEFAULT_INSTALL_DIR"
}

bootstrap_git() {
    if command -v git >/dev/null 2>&1; then
        return
    fi
    if command -v apt-get >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        apt-get update
        apt-get install -y --no-install-recommends git
        unset DEBIAN_FRONTEND DEBCONF_NONINTERACTIVE_SEEN
        return
    fi
    log_error "git не найден. Установите git или клонируйте репозиторий вручную."
    exit 1
}

RUNTIME_BACKUP_DIR="/var/lib/esimker"

save_runtime_backup() {
    local dir="$1"
    mkdir -p "$RUNTIME_BACKUP_DIR"
    if [[ -f "$dir/.env" ]]; then
        cp "$dir/.env" "$RUNTIME_BACKUP_DIR/.env"
        chmod 600 "$RUNTIME_BACKUP_DIR/.env"
    fi
    if [[ -d "$dir/data" ]] && [[ -n "$(ls -A "$dir/data" 2>/dev/null || true)" ]]; then
        rm -rf "$RUNTIME_BACKUP_DIR/data"
        cp -a "$dir/data" "$RUNTIME_BACKUP_DIR/data"
    fi
}

restore_runtime_backup() {
    local dir="$1"
    if [[ ! -f "$dir/.env" && -f "$RUNTIME_BACKUP_DIR/.env" ]]; then
        cp "$RUNTIME_BACKUP_DIR/.env" "$dir/.env"
        chmod 600 "$dir/.env"
        log_success "  ✔ .env восстановлен из ${RUNTIME_BACKUP_DIR}/"
    fi
    if [[ -d "$RUNTIME_BACKUP_DIR/data" ]]; then
        if [[ ! -d "$dir/data" ]] || [[ -z "$(ls -A "$dir/data" 2>/dev/null || true)" ]]; then
            mkdir -p "$dir/data"
            cp -a "$RUNTIME_BACKUP_DIR/data/." "$dir/data/"
            chmod 755 "$dir/data"
            log_success "  ✔ data/ восстановлена из ${RUNTIME_BACKUP_DIR}/"
        fi
    fi
}

nginx_read_domain() {
    local domain=""
    if [[ -f "$NGINX_CONF" ]]; then
        domain="$(grep -E 'server_name ' "$NGINX_CONF" 2>/dev/null | grep -vE 'server_name\s+_;' | head -n1 | awk '{print $2}' | tr -d ';' || true)"
    fi
    echo "$domain"
}

nginx_read_ssl_port() {
    local port=""
    if [[ -f "$NGINX_CONF" ]]; then
        port="$(grep -E 'listen .* ssl' "$NGINX_CONF" 2>/dev/null | head -n1 | awk '{print $2}' | tr -d ';' || true)"
    fi
    echo "$port"
}

nginx_read_http_port() {
    local port=""
    if [[ -f "$NGINX_CONF" ]]; then
        port="$(grep -E '127\.0\.0\.1:[0-9]+' "$NGINX_CONF" 2>/dev/null | head -n1 | grep -oE '[0-9]+$' || true)"
    fi
    echo "$port"
}

certbot_email_for_domain() {
    local domain="$1"
    local conf="/etc/letsencrypt/renewal/${domain}.conf"
    local email=""
    if [[ -f "$conf" ]]; then
        email="$(grep -m1 '^account = ' "$conf" 2>/dev/null | sed 's/.*mailto:\([^]]*\).*/\1/' || true)"
    fi
    echo "$email"
}

env_get() {
    local key="$1"
    [[ -f ".env" ]] || return 1
    grep -m1 "^${key}=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r'
}

env_is_set() {
    local val
    val="$(env_get "$1" 2>/dev/null || true)"
    [[ -n "${val// /}" ]]
}

env_set() {
    local key="$1"
    local value="$2"
    local tmp
    tmp="$(mktemp)"
    if [[ -f ".env" ]]; then
        grep -v "^${key}=" .env >"$tmp" 2>/dev/null || true
    else
        : >"$tmp"
    fi
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
    mv "$tmp" .env
    chmod 600 .env
}

env_set_default() {
    env_is_set "$1" || env_set "$1" "$2"
}

ensure_env_file() {
    log_info "\nПроверка .env"

    restore_runtime_backup "$(pwd)"

    if [[ ! -f ".env" ]]; then
        if [[ -f ".env.example" ]]; then
            cp .env.example .env
        else
            touch .env
        fi
        chmod 600 .env
        log_warn "  .env создан — заполните недостающие поля"
    fi

    local domain webhook_domain email ssl_port http_port
    local bot_token bot_username platega_mid platega_sec dent_id dent_secret
    local domain_input webhook_input email_input ssl_input http_input rate_input

    domain="${INSTALL_DOMAIN:-$(env_get DOMAIN 2>/dev/null || true)}"
    webhook_domain="${INSTALL_WEBHOOK_DOMAIN:-$(env_get PLATEGA_WEBHOOK_DOMAIN 2>/dev/null || true)}"
    local panel_domain="${INSTALL_PANEL_DOMAIN:-$(env_get PANEL_DOMAIN 2>/dev/null || true)}"
    email="${INSTALL_SSL_EMAIL:-$(env_get SSL_EMAIL 2>/dev/null || true)}"
    ssl_port="${INSTALL_SSL_PORT:-$DEFAULT_SSL_PORT}"
    http_port="${INSTALL_HTTP_PORT:-$(env_get HTTP_PORT 2>/dev/null || true)}"
    http_port="${http_port:-$DEFAULT_HTTP_PORT}"

    if ! env_is_set telegram_bot_token; then
        section "Telegram-бот"
        prompt_secret "  Токен бота (telegram_bot_token): " bot_token
        if [[ -z "$bot_token" ]]; then
            log_error "telegram_bot_token обязателен."
            exit 1
        fi
        env_set telegram_bot_token "$bot_token"
    else
        log_success "  ✔ telegram_bot_token"
    fi

    if ! env_is_set telegram_bot_username; then
        prompt "  Username бота без @: " bot_username_input
        bot_username="$(sanitize_bot_username "$bot_username_input")"
        if [[ -z "$bot_username" ]]; then
            log_error "telegram_bot_username обязателен."
            exit 1
        fi
        env_set telegram_bot_username "$bot_username"
    else
        log_success "  ✔ telegram_bot_username"
        bot_username="$(env_get telegram_bot_username)"
    fi

    if ! env_is_set DOMAIN; then
        if [[ -n "$domain" ]]; then
            prompt "  Домен приложения [${domain}]: " domain_input
            domain="$(sanitize_domain "${domain_input:-$domain}")"
        else
            domain="$(nginx_read_domain)"
            if [[ -n "$domain" ]]; then
                prompt "  Домен приложения [${domain}]: " domain_input
                domain="$(sanitize_domain "${domain_input:-$domain}")"
            else
                prompt "  Домен приложения (app.example.com): " domain_input
                domain="$(sanitize_domain "$domain_input")"
            fi
        fi
        if [[ -z "$domain" ]]; then
            log_error "DOMAIN обязателен."
            exit 1
        fi
        env_set DOMAIN "$domain"
    else
        log_success "  ✔ DOMAIN"
        domain="$(env_get DOMAIN)"
    fi

    if ! env_is_set PLATEGA_WEBHOOK_DOMAIN; then
        section "Platega — webhook-домен"
        hint "Отдельный поддомен для callback (например pay.example.com)"
        if [[ -n "$webhook_domain" ]]; then
            prompt "  Домен webhook [${webhook_domain}]: " webhook_input
            webhook_domain="$(sanitize_domain "${webhook_input:-$webhook_domain}")"
        else
            prompt "  Домен webhook (pay.example.com): " webhook_input
            webhook_domain="$(sanitize_domain "$webhook_input")"
        fi
        if [[ -z "$webhook_domain" ]]; then
            log_error "PLATEGA_WEBHOOK_DOMAIN обязателен."
            exit 1
        fi
        env_set PLATEGA_WEBHOOK_DOMAIN "$webhook_domain"
    else
        log_success "  ✔ PLATEGA_WEBHOOK_DOMAIN"
        webhook_domain="$(env_get PLATEGA_WEBHOOK_DOMAIN)"
    fi

    if ! env_is_set PANEL_DOMAIN; then
        section "Панель администратора — домен"
        hint "Отдельный поддомен (например panel.example.com)"
        local panel_domain_input
        if [[ -n "$panel_domain" ]]; then
            prompt "  Домен панели [${panel_domain}]: " panel_domain_input
            panel_domain="$(sanitize_domain "${panel_domain_input:-$panel_domain}")"
        else
            prompt "  Домен панели (panel.example.com): " panel_domain_input
            panel_domain="$(sanitize_domain "$panel_domain_input")"
        fi
        if [[ -z "$panel_domain" ]]; then
            log_error "PANEL_DOMAIN обязателен."
            exit 1
        fi
        env_set PANEL_DOMAIN "$panel_domain"
    else
        log_success "  ✔ PANEL_DOMAIN"
    fi

    if ! env_is_set platega_merchant_id || ! env_is_set platega_secret; then
        section "Platega — API"
        hint "Личный кабинет → Merchant ID и Secret Key"
    fi
    if ! env_is_set platega_merchant_id; then
        prompt "  platega_merchant_id: " platega_mid
        if [[ -z "$platega_mid" ]]; then
            log_error "platega_merchant_id обязателен."
            exit 1
        fi
        env_set platega_merchant_id "$platega_mid"
    else
        log_success "  ✔ platega_merchant_id"
    fi
    if ! env_is_set platega_secret; then
        prompt_secret "  platega_secret: " platega_sec
        if [[ -z "$platega_sec" ]]; then
            log_error "platega_secret обязателен."
            exit 1
        fi
        env_set platega_secret "$platega_sec"
    else
        log_success "  ✔ platega_secret"
    fi
    if ! env_is_set PLATEGA_USD_RUB_RATE; then
        prompt "  Курс USD→RUB [95]: " rate_input
        env_set PLATEGA_USD_RUB_RATE "${rate_input:-95}"
    else
        log_success "  ✔ PLATEGA_USD_RUB_RATE"
    fi

    if ! env_is_set SSL_EMAIL; then
        email="${email:-$(certbot_email_for_domain "$domain" 2>/dev/null || true)}"
        if [[ -n "$email" ]]; then
            prompt "  Email Let's Encrypt [${email}]: " email_input
            email="${email_input:-$email}"
        else
            prompt "  Email Let's Encrypt: " email
        fi
        email="${email:-admin@${domain}}"
        env_set SSL_EMAIL "$email"
    else
        log_success "  ✔ SSL_EMAIL"
    fi

    if ! env_is_set MINIAPP_URL; then
        env_set MINIAPP_URL "$(url_with_port "$domain" "$ssl_port")"
    fi

    env_set_default ENVIRONMENT production
    env_set_default DB_PATH data/data.db
    env_set_default API_HOST 0.0.0.0
    env_set_default API_PORT 8000
    env_set_default INIT_DATA_MAX_AGE_SECONDS 86400
    env_set_default API_RATE_LIMIT_PER_MINUTE 120

    if ! env_is_set HTTP_PORT; then
        env_set HTTP_PORT "$http_port"
    fi
    HTTP_PORT="$(env_get HTTP_PORT)"

    if ! env_is_set PANEL_HTTP_PORT; then
        env_set PANEL_HTTP_PORT "${INSTALL_PANEL_HTTP_PORT:-$DEFAULT_PANEL_HTTP_PORT}"
    fi

    if ! env_is_set VITE_TELEGRAM_BOT_USERNAME; then
        env_set VITE_TELEGRAM_BOT_USERNAME "${bot_username:-$(env_get telegram_bot_username)}"
    fi

    if ! grep -q '^dent_client_id=' .env 2>/dev/null; then
        section "DENT Giga Store (опционально)"
        hint "Enter — пропустить"
        prompt "  dent_client_id: " dent_id
        env_set dent_client_id "${dent_id:-}"
        prompt "  dent_client_secret: " dent_secret
        env_set dent_client_secret "${dent_secret:-}"
    fi

    save_runtime_backup "$(pwd)"
    generate_admin_credentials
    log_success "  ✔ .env готов"
}

generate_admin_credentials() {
    local login password hash secret
    local need_generate=0

    if env_is_set admin_password_hash && env_is_set admin_session_secret; then
        case "${ESIMKER_RESET_PANEL_PASSWORD:-}" in
            1|yes|true|TRUE)
                need_generate=1
                log_info "  Сброс пароля панели (ESIMKER_RESET_PANEL_PASSWORD)"
                ;;
            0|no|false|FALSE)
                log_success "  ✔ учётные данные панели (без изменений)"
                INSTALL_PANEL_LOGIN="$(env_get admin_login 2>/dev/null || echo admin)"
                return
                ;;
            *)
                section "Панель администратора"
                hint "Пароль хранится только в виде хэша — восстановить нельзя"
                if confirm "  Сгенерировать новый пароль и показать в конце? (y/n): "; then
                    need_generate=1
                else
                    log_success "  ✔ учётные данные панели (без изменений)"
                    INSTALL_PANEL_LOGIN="$(env_get admin_login 2>/dev/null || echo admin)"
                    return
                fi
                ;;
        esac
    else
        need_generate=1
    fi

    if [[ "$need_generate" -eq 0 ]]; then
        return
    fi

    section "Панель администратора"
    login="admin"
    password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16)"
    if ! command -v python3 >/dev/null 2>&1; then
        log_error "python3 нужен для генерации пароля панели."
        exit 1
    fi
    hash="$(ADMIN_PW="$password" python3 -c "import os, bcrypt; print(bcrypt.hashpw(os.environ['ADMIN_PW'].encode(), bcrypt.gensalt()).decode())")"
    secret="$(openssl rand -hex 32)"
    env_set admin_login "$login"
    env_set admin_password_hash "$hash"
    env_set admin_session_secret "$secret"
    INSTALL_PANEL_LOGIN="$login"
    INSTALL_PANEL_PASSWORD="$password"
    log_success "  ✔ учётные данные панели сгенерированы (будут показаны в конце)"
}

sync_from_github() {
    local dir="$1"
    bootstrap_git

    if [[ ! -d "$dir/.git" ]]; then
        if [[ -d "$dir" && -n "$(ls -A "$dir" 2>/dev/null || true)" ]]; then
            log_error "Каталог ${dir} существует, но это не git-репозиторий. Удалите его или задайте ESIMKER_INSTALL_DIR."
            exit 1
        fi
        log_info "Клонирование esimker в ${dir}..."
        mkdir -p "$(dirname "$dir")"
        git clone --branch "$GIT_BRANCH" "$REPO_URL" "$dir"
        log_success "  ✔ репозиторий склонирован"
        return
    fi

    # Сохраняем .env и data/ — они не в git; reset/clean их не трогает, но clean на старых версиях удалял.
    save_runtime_backup "$dir"

    local backup_dir
    backup_dir="$(mktemp -d)"
    if [[ -f "$dir/.env" ]]; then
        cp "$dir/.env" "$backup_dir/.env"
    fi
    if [[ -d "$dir/data" ]]; then
        cp -a "$dir/data" "$backup_dir/data"
    fi

    log_info "Загрузка последней версии с GitHub (${GIT_BRANCH})..."
    git -C "$dir" fetch origin "$GIT_BRANCH"
    git -C "$dir" checkout "$GIT_BRANCH"
    if ! git -C "$dir" merge --ff-only "origin/${GIT_BRANCH}" 2>/dev/null; then
        git -C "$dir" reset --hard "origin/${GIT_BRANCH}"
    fi

    if [[ -f "$backup_dir/.env" ]]; then
        cp "$backup_dir/.env" "$dir/.env"
        chmod 600 "$dir/.env"
    fi
    if [[ -d "$backup_dir/data" ]]; then
        mkdir -p "$dir/data"
        cp -a "$backup_dir/data/." "$dir/data/"
        chmod 755 "$dir/data"
    fi
    rm -rf "$backup_dir"

    restore_runtime_backup "$dir"
    save_runtime_backup "$dir"

    log_success "  ✔ код обновлён ($(git -C "$dir" rev-parse --short HEAD))"
}

ensure_project_checkout() {
    local dir="$1"
    if [[ -f "$dir/docker-compose.yml" ]]; then
        return
    fi
    sync_from_github "$dir"
}

prepare_project_root() {
    local project_dir
    project_dir="$(resolve_project_dir)"

    if should_sync_from_github "$project_dir"; then
        log_info "Синхронизация с GitHub → ${project_dir}"
        sync_from_github "$project_dir"
    else
        ensure_project_checkout "$project_dir"
    fi

    cd "$project_dir"
    SCRIPT_DIR="$project_dir"
}

# После git pull перезапускаем install.sh из репозитория (pipe-версия может быть устаревшей).
reexec_from_repo_if_needed() {
    [[ "${ESIMKER_REEXEC:-}" == "1" ]] && return

    local repo_script="${SCRIPT_DIR}/install.sh"
    local source="${BASH_SOURCE[0]:-}"

    if [[ ! -f "$repo_script" ]]; then
        return
    fi

    if [[ -n "$source" && "$source" == "$repo_script" ]]; then
        return
    fi

    if should_sync_from_github "$SCRIPT_DIR"; then
        export ESIMKER_REEXEC=1
        log_info "Перезапуск install.sh из репозитория..."
        exec bash "$repo_script"
    fi
}

prompt() {
    local message="$1"
    local __var="$2"
    local value
    read -r -p "$message" value < /dev/tty
    printf -v "$__var" '%s' "$value"
}

prompt_secret() {
    local message="$1"
    local __var="$2"
    local value
    read -r -s -p "$message" value < /dev/tty
    echo
    printf -v "$__var" '%s' "$value"
}

confirm() {
    local message="$1"
    local reply
    read -r -n1 -p "$message" reply < /dev/tty || true
    echo
    [[ "$reply" =~ ^[YyДд]$ ]]
}

sanitize_domain() {
    local input="$1"
    echo "$input" \
        | sed -e 's%^https\?://%%' -e 's%:.*$%%' -e 's%/.*$%%' \
        | tr -cd 'A-Za-z0-9.-' \
        | tr '[:upper:]' '[:lower:]'
}

sanitize_bot_username() {
    local input="$1"
    echo "$input" | sed 's/^@//' | tr -cd 'A-Za-z0-9_'
}

get_server_ip() {
    local ipv4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    local ip
    for url in \
        "https://api.ipify.org" \
        "https://ifconfig.co/ip" \
        "https://ipv4.icanhazip.com"; do
        ip=$(curl -fsS --max-time 8 "$url" 2>/dev/null | tr -d '\r\n\t ')
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    done
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [[ $ip =~ $ipv4_re ]]; then
        echo "$ip"
    fi
}

resolve_domain_ip() {
    local domain="$1"
    local ipv4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    local ip
    ip=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | head -n1)
    if [[ $ip =~ $ipv4_re ]]; then
        echo "$ip"
        return 0
    fi
    if command -v dig >/dev/null 2>&1; then
        ip=$(dig +short A "$domain" 2>/dev/null | grep -E "$ipv4_re" | head -n1)
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    fi
    return 1
}

dc() {
    if docker compose version >/dev/null 2>&1; then
        sudo docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        sudo docker-compose "$@"
    else
        log_error "Docker Compose не найден. Установите docker-compose-plugin."
        exit 1
    fi
}

require_project_root() {
    if [[ ! -f "docker-compose.yml" ]]; then
        log_error "Запустите install.sh из корня репозитория esimker (где лежит docker-compose.yml)."
        exit 1
    fi
}

ensure_packages() {
    log_info "\nШаг 1: системные зависимости"

    declare -A packages=(
        [curl]='curl'
        [git]='git'
        [nginx]='nginx'
        [certbot]='certbot'
        [dig]='dnsutils'
    )

    if ! command -v docker >/dev/null 2>&1; then
        packages[docker]='docker.io'
    fi

    local missing=()
    for cmd in "${!packages[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_warn "  '$cmd' не найден — установим '${packages[$cmd]}'"
            missing+=("${packages[$cmd]}")
        else
            log_success "  ✔ $cmd"
        fi
    done

    if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
        log_warn "  Docker Compose plugin не найден — установим docker-compose-plugin"
        missing+=('docker-compose-plugin')
    else
        log_success "  ✔ docker compose"
    fi

    if ((${#missing[@]})); then
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends "${missing[@]}"
        unset DEBIAN_FRONTEND DEBCONF_NONINTERACTIVE_SEEN
    fi
}

ensure_services() {
    for service in docker nginx; do
        if ! sudo systemctl is-active --quiet "$service"; then
            log_warn "  Сервис $service не запущен — включаем..."
            sudo systemctl enable "$service"
            sudo systemctl start "$service"
        else
            log_success "  ✔ $service активен"
        fi
    done
}

ensure_certbot_nginx() {
    log_info "\nПроверка Certbot (nginx plugin)"

    if certbot plugins 2>/dev/null | grep -qi nginx; then
        log_success "  ✔ nginx plugin для Certbot найден"
        return
    fi

    export DEBIAN_FRONTEND=noninteractive
    export DEBCONF_NONINTERACTIVE_SEEN=true
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends python3-certbot-nginx
    unset DEBIAN_FRONTEND DEBCONF_NONINTERACTIVE_SEEN

    if certbot plugins 2>/dev/null | grep -qi nginx; then
        log_success "  ✔ nginx plugin установлен"
        return
    fi

    log_error "Не удалось установить python3-certbot-nginx"
    exit 1
}

url_with_port() {
    local domain="$1"
    local ssl_port="$2"
    if [[ "$ssl_port" == "443" ]]; then
        echo "https://${domain}"
    else
        echo "https://${domain}:${ssl_port}"
    fi
}

write_nginx_config() {
    local domain="$1"
    local ssl_port="$2"
    local http_port="$3"

    log_info "\nНастройка Nginx → 127.0.0.1:${http_port}"

    local https_redirect
    if [[ "$ssl_port" == "443" ]]; then
        https_redirect='return 301 https://$host$request_uri;'
    else
        https_redirect="return 301 https://\$host:${ssl_port}\$request_uri;"
    fi

    sudo tee "$NGINX_CONF" >/dev/null <<EOF
# ${PROJECT_NAME} — generated by install.sh
upstream esimker_web {
    server 127.0.0.1:${http_port};
    keepalive 8;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        ${https_redirect}
    }
}

server {
    listen ${ssl_port} ssl http2;
    listen [::]:${ssl_port} ssl http2;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 1m;

    location / {
        proxy_pass http://esimker_web;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 60s;
        proxy_connect_timeout 15s;
    }
}
EOF

    sudo rm -f /etc/nginx/sites-enabled/default
    sudo ln -sf "$NGINX_CONF" "$NGINX_LINK"
    sudo nginx -t
    sudo systemctl reload nginx
    log_success "  ✔ Nginx настроен"
}

write_webhook_nginx_config() {
    local webhook_domain="$1"
    local ssl_port="$2"
    local http_port="$3"

    log_info "\nNginx webhook Platega → 127.0.0.1:${http_port} (${webhook_domain})"

    local https_redirect
    if [[ "$ssl_port" == "443" ]]; then
        https_redirect='return 301 https://$host$request_uri;'
    else
        https_redirect="return 301 https://\$host:${ssl_port}\$request_uri;"
    fi

    sudo tee "$NGINX_WEBHOOK_CONF" >/dev/null <<EOF
# ${PROJECT_NAME} Platega webhooks — generated by install.sh
server {
    listen 80;
    listen [::]:80;
    server_name ${webhook_domain};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        ${https_redirect}
    }
}

server {
    listen ${ssl_port} ssl http2;
    listen [::]:${ssl_port} ssl http2;
    server_name ${webhook_domain};

    ssl_certificate /etc/letsencrypt/live/${webhook_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${webhook_domain}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 1m;

    location /api/webhooks/platega {
        proxy_pass http://127.0.0.1:${http_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 60s;
        proxy_connect_timeout 15s;
    }

    location / {
        return 404;
    }
}
EOF

    sudo ln -sf "$NGINX_WEBHOOK_CONF" "$NGINX_WEBHOOK_LINK"
    sudo nginx -t
    sudo systemctl reload nginx
    log_success "  ✔ Nginx webhook настроен"
}

write_panel_nginx_config() {
    local panel_domain="$1"
    local ssl_port="$2"
    local panel_http_port="$3"

    log_info "\nНастройка Nginx панели → 127.0.0.1:${panel_http_port}"

    local https_redirect
    if [[ "$ssl_port" == "443" ]]; then
        https_redirect='return 301 https://$host$request_uri;'
    else
        https_redirect="return 301 https://\$host:${ssl_port}\$request_uri;"
    fi

    sudo tee "$NGINX_PANEL_CONF" >/dev/null <<EOF
# ${PROJECT_NAME} admin panel — generated by install.sh
upstream esimker_panel {
    server 127.0.0.1:${panel_http_port};
    keepalive 8;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${panel_domain};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        ${https_redirect}
    }
}

server {
    listen ${ssl_port} ssl http2;
    listen [::]:${ssl_port} ssl http2;
    server_name ${panel_domain};

    ssl_certificate /etc/letsencrypt/live/${panel_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${panel_domain}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 2m;

    location / {
        proxy_pass http://esimker_panel;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 60s;
        proxy_connect_timeout 15s;
    }
}
EOF

    sudo ln -sf "$NGINX_PANEL_CONF" "$NGINX_PANEL_LINK"
    sudo nginx -t
    sudo systemctl reload nginx
    log_success "  ✔ Nginx панели настроен"
}

ensure_panel_infrastructure() {
    local panel_domain panel_http_port ssl_port email

    panel_domain="$(env_get PANEL_DOMAIN 2>/dev/null || true)"
    [[ -n "$panel_domain" ]] || return 0

    panel_http_port="$(env_get PANEL_HTTP_PORT 2>/dev/null || true)"
    panel_http_port="${panel_http_port:-$DEFAULT_PANEL_HTTP_PORT}"

    ssl_port="$(nginx_read_ssl_port 2>/dev/null || true)"
    ssl_port="${ssl_port:-$DEFAULT_SSL_PORT}"

    email="$(env_get SSL_EMAIL 2>/dev/null || true)"
    email="${email:-admin@${panel_domain}}"

    issue_certificates "$panel_domain" "$email"
    write_panel_nginx_config "$panel_domain" "$ssl_port" "$panel_http_port"
}

ensure_webhook_infrastructure() {
    local webhook_domain http_port ssl_port email

    webhook_domain="$(env_get PLATEGA_WEBHOOK_DOMAIN 2>/dev/null || true)"
    [[ -n "$webhook_domain" ]] || return 0

    http_port="$(env_get HTTP_PORT 2>/dev/null || true)"
    http_port="${http_port:-$DEFAULT_HTTP_PORT}"

    ssl_port="$(nginx_read_ssl_port 2>/dev/null || true)"
    ssl_port="${ssl_port:-$DEFAULT_SSL_PORT}"

    email="$(env_get SSL_EMAIL 2>/dev/null || true)"
    email="${email:-admin@${webhook_domain}}"

    issue_certificates "$webhook_domain" "$email"
    write_webhook_nginx_config "$webhook_domain" "$ssl_port" "$http_port"
}

issue_certificates() {
    local domain="$1"
    local email="$2"

    sudo mkdir -p "$CERTBOT_WEBROOT"

    if [[ -d "/etc/letsencrypt/live/${domain}" ]]; then
        log_success "  ✔ SSL-сертификат для ${domain} уже есть"
        return
    fi

    log_info "  Получение сертификата Let's Encrypt для ${domain}..."

    local temp_conf="/tmp/${PROJECT_NAME}_certbot_${domain}.conf"
    local restore_link=""
    if [[ -L "$NGINX_LINK" ]]; then
        restore_link="$(readlink -f "$NGINX_LINK" 2>/dev/null || readlink "$NGINX_LINK" 2>/dev/null || true)"
    fi

    sudo tee "$temp_conf" >/dev/null <<EOF
server {
    listen 80;
    server_name ${domain};
    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }
    location / {
        return 404;
    }
}
EOF

    sudo rm -f "$NGINX_LINK"
    sudo ln -sf "$temp_conf" "$NGINX_LINK"
    sudo nginx -t && sudo systemctl reload nginx

    sudo certbot certonly --webroot \
        -w "$CERTBOT_WEBROOT" \
        -d "$domain" \
        --email "$email" \
        --agree-tos \
        --non-interactive

    sudo rm -f "$temp_conf"
    if [[ -n "$restore_link" && -f "$restore_link" ]]; then
        sudo ln -sf "$restore_link" "$NGINX_LINK"
        sudo nginx -t && sudo systemctl reload nginx
    fi

    log_success "  ✔ Сертификат получен"
}

start_containers() {
    log_info "\nСборка и запуск Docker-контейнеров"

    mkdir -p data
    chmod 755 data

    if dc ps -q 2>/dev/null | grep -q .; then
        dc down --remove-orphans
    fi

    dc up -d --build

    log_info "  Ожидание готовности API..."
    local i
    for i in $(seq 1 30); do
        if curl -fsS "http://127.0.0.1:${HTTP_PORT:-8080}/api/health" >/dev/null 2>&1; then
            log_success "  ✔ API отвечает"
            return
        fi
        sleep 2
    done

    log_warn "  API пока не отвечает — проверьте: docker compose logs api"
}

section() {
    local title="$1"
    printf '\n  %s%s%s\n' "$BOLD" "$title" "$NC"
}

hint() {
    printf '     %s↳ %s%s\n' "$DIM" "$1" "$NC"
}

print_summary() {
    local domain="$1"
    local ssl_port="$2"
    local miniapp_url webhook_domain webhook_url panel_domain panel_url
    miniapp_url="$(url_with_port "$domain" "$ssl_port")"
    webhook_domain="$(env_get PLATEGA_WEBHOOK_DOMAIN 2>/dev/null || true)"
    panel_domain="$(env_get PANEL_DOMAIN 2>/dev/null || true)"
    if [[ -n "$webhook_domain" ]]; then
        webhook_url="$(url_with_port "$webhook_domain" "$ssl_port")/api/webhooks/platega"
    fi
    if [[ -n "$panel_domain" ]]; then
        panel_url="$(url_with_port "$panel_domain" "$ssl_port")"
    fi

    printf '\n'
    printf "${GREEN}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${NC}\n"
    printf "${GREEN}┃${NC}  🎉 ${BOLD}esimker установлен${NC} 🎉                              ${GREEN}┃${NC}\n"
    printf "${GREEN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${NC}\n"
    printf '\n'
    printf "  Мини-приложение:  ${YELLOW}%s${NC}\n" "$miniapp_url"
    if [[ -n "$panel_url" ]]; then
        printf "  Панель админа:    ${YELLOW}%s${NC}\n" "$panel_url"
    fi
    printf "  API health:       ${YELLOW}%s/api/health${NC}\n" "$miniapp_url"
    if [[ -n "$webhook_url" ]]; then
        printf "  Platega webhook:  ${YELLOW}%s${NC}\n" "$webhook_url"
    fi
    printf '\n'
    printf "${BOLD}  Обязательно в @BotFather:${NC}\n"
    printf "  1. Bot Settings → Menu Button / Web App URL → ${CYAN}%s${NC}\n" "$miniapp_url"
    printf "  2. Bot Settings → Domain (Login Widget)   → ${CYAN}%s${NC}\n" "$domain"
    if [[ -n "$webhook_url" ]]; then
        printf '\n'
        printf "${BOLD}  Platega (личный кабинет):${NC}\n"
        printf "  Callback URL → ${CYAN}%s${NC}\n" "$webhook_url"
    fi
    if [[ -n "${INSTALL_PANEL_PASSWORD:-}" ]]; then
        printf '\n'
        printf "${BOLD}${YELLOW}  ═══ Панель администратора (сохраните!) ═══${NC}\n"
        printf "  URL:      ${CYAN}%s${NC}\n" "${panel_url:-—}"
        printf "  Логин:    ${CYAN}%s${NC}\n" "${INSTALL_PANEL_LOGIN:-admin}"
        printf "  Пароль:   ${CYAN}%s${NC}\n" "$INSTALL_PANEL_PASSWORD"
        printf "  ${DIM}(пароль в .env не хранится — только хэш)${NC}\n"
        unset INSTALL_PANEL_LOGIN INSTALL_PANEL_PASSWORD
    elif [[ -n "$panel_url" ]] && env_is_set admin_password_hash; then
        printf '\n'
        printf "${BOLD}  Панель администратора:${NC}\n"
        printf "  URL:      ${CYAN}%s${NC}\n" "$panel_url"
        printf "  Логин:    ${CYAN}%s${NC}\n" "$(env_get admin_login 2>/dev/null || echo admin)"
        printf "  ${DIM}Пароль уже задан. При следующем install.sh ответьте «y» на сброс пароля${NC}\n"
        printf "  ${DIM}или запустите: ESIMKER_RESET_PANEL_PASSWORD=1 ./install.sh${NC}\n"
    fi
    printf '\n'
    printf "${BOLD}  Полезные команды:${NC}\n"
    printf "  docker compose ps\n"
    printf "  docker compose logs -f api bot web panel\n"
    printf "  ./install.sh          # повторный запуск = обновление\n"
    printf '\n'
}

run_update() {
    log_info "Режим обновления (найден ${NGINX_CONF})"

    ensure_env_file

    local http_port="$DEFAULT_HTTP_PORT"
    local domain=""
    local ssl_port="$DEFAULT_SSL_PORT"
    if [[ -f ".env" ]]; then
        http_port="$(grep -m1 '^HTTP_PORT=' .env | cut -d= -f2- | tr -d '\r' || true)"
        http_port="${http_port:-$DEFAULT_HTTP_PORT}"
        domain="$(grep -m1 '^DOMAIN=' .env | cut -d= -f2- | tr -d '\r' || true)"
    fi
    HTTP_PORT="$http_port"
    ssl_port="$(nginx_read_ssl_port 2>/dev/null || true)"
    ssl_port="${ssl_port:-$DEFAULT_SSL_PORT}"

    ensure_webhook_infrastructure
    ensure_panel_infrastructure
    start_containers

    if [[ -f "$NGINX_CONF" ]]; then
        sudo nginx -t && sudo systemctl reload nginx
    fi

    if [[ -z "$domain" && -f ".env" ]]; then
        domain="$(grep -m1 '^DOMAIN=' .env | cut -d= -f2- | tr -d '\r' || true)"
    fi
    if [[ -n "$domain" ]]; then
        print_summary "$domain" "$ssl_port"
    else
        log_success "Обновление завершено."
    fi
}

run_install() {
    log_success "--- Установка esimker ---"

    ensure_packages
    ensure_services
    ensure_certbot_nginx

    log_info "\nШаг 2: домены и SSL"

    prompt "  Домен мини-приложения (app.example.com): " domain_input
    DOMAIN="$(sanitize_domain "$domain_input")"
    if [[ -z "$DOMAIN" ]]; then
        log_error "Некорректный домен."
        exit 1
    fi

    prompt "  Домен webhook Platega (pay.example.com): " webhook_input
    WEBHOOK_DOMAIN="$(sanitize_domain "$webhook_input")"
    if [[ -z "$WEBHOOK_DOMAIN" ]]; then
        log_error "Домен webhook Platega обязателен."
        exit 1
    fi

    prompt "  Домен панели администратора (panel.example.com): " panel_input
    PANEL_DOMAIN="$(sanitize_domain "$panel_input")"
    if [[ -z "$PANEL_DOMAIN" ]]; then
        log_error "Домен панели обязателен."
        exit 1
    fi

    prompt "  Email для Let's Encrypt: " SSL_EMAIL
    if [[ -z "$SSL_EMAIL" ]]; then
        log_error "Email обязателен."
        exit 1
    fi

    prompt "  SSL-порт (по умолчанию 443): " ssl_port_input
    SSL_PORT="${ssl_port_input:-$DEFAULT_SSL_PORT}"

    prompt "  Внутренний порт Docker web (по умолчанию ${DEFAULT_HTTP_PORT}): " http_port_input
    HTTP_PORT="${http_port_input:-$DEFAULT_HTTP_PORT}"

    prompt "  Внутренний порт Docker panel (по умолчанию ${DEFAULT_PANEL_HTTP_PORT}): " panel_port_input
    PANEL_HTTP_PORT="${panel_port_input:-$DEFAULT_PANEL_HTTP_PORT}"

    SERVER_IP="$(get_server_ip || true)"
    DOMAIN_IP="$(resolve_domain_ip "$DOMAIN" || true)"
    WEBHOOK_DOMAIN_IP="$(resolve_domain_ip "$WEBHOOK_DOMAIN" || true)"
    PANEL_DOMAIN_IP="$(resolve_domain_ip "$PANEL_DOMAIN" || true)"

    if [[ -n "$SERVER_IP" ]]; then
        log_info "  IP сервера: ${SERVER_IP}"
    fi
    if [[ -n "$DOMAIN_IP" ]]; then
        log_info "  IP домена ${DOMAIN}: ${DOMAIN_IP}"
    fi
    if [[ -n "$WEBHOOK_DOMAIN_IP" ]]; then
        log_info "  IP домена ${WEBHOOK_DOMAIN}: ${WEBHOOK_DOMAIN_IP}"
    fi
    if [[ -n "$SERVER_IP" && -n "$DOMAIN_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
        log_warn "  DNS ${DOMAIN} не указывает на этот сервер."
        confirm "  Продолжить? (y/n): " || exit 1
    fi
    if [[ -n "$SERVER_IP" && -n "$WEBHOOK_DOMAIN_IP" && "$SERVER_IP" != "$WEBHOOK_DOMAIN_IP" ]]; then
        log_warn "  DNS ${WEBHOOK_DOMAIN} не указывает на этот сервер."
        confirm "  Продолжить? (y/n): " || exit 1
    fi

    if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q 'Status: active'; then
        log_warn "  UFW активен — открываем 80 и ${SSL_PORT}"
        sudo ufw allow 80/tcp
        sudo ufw allow "${SSL_PORT}"/tcp
    fi

    issue_certificates "$DOMAIN" "$SSL_EMAIL"
    issue_certificates "$WEBHOOK_DOMAIN" "$SSL_EMAIL"
    issue_certificates "$PANEL_DOMAIN" "$SSL_EMAIL"
    write_nginx_config "$DOMAIN" "$SSL_PORT" "$HTTP_PORT"
    write_webhook_nginx_config "$WEBHOOK_DOMAIN" "$SSL_PORT" "$HTTP_PORT"
    write_panel_nginx_config "$PANEL_DOMAIN" "$SSL_PORT" "$PANEL_HTTP_PORT"

    INSTALL_DOMAIN="$DOMAIN"
    INSTALL_WEBHOOK_DOMAIN="$WEBHOOK_DOMAIN"
    INSTALL_PANEL_DOMAIN="$PANEL_DOMAIN"
    INSTALL_SSL_EMAIL="$SSL_EMAIL"
    INSTALL_SSL_PORT="$SSL_PORT"
    INSTALL_HTTP_PORT="$HTTP_PORT"
    INSTALL_PANEL_HTTP_PORT="$PANEL_HTTP_PORT"
    ensure_env_file
    unset INSTALL_DOMAIN INSTALL_WEBHOOK_DOMAIN INSTALL_PANEL_DOMAIN INSTALL_SSL_EMAIL INSTALL_SSL_PORT INSTALL_HTTP_PORT INSTALL_PANEL_HTTP_PORT

    start_containers
    print_summary "$DOMAIN" "$SSL_PORT"
}

# ── Entry ────────────────────────────────────────────────────────────────────

prepare_project_root
reexec_from_repo_if_needed
require_project_root

if [[ -f "$NGINX_CONF" ]]; then
    run_update
else
    run_install
fi
