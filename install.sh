#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_NAME="esimker"
NGINX_CONF="/etc/nginx/sites-available/${PROJECT_NAME}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${PROJECT_NAME}.conf"
CERTBOT_WEBROOT="/var/www/certbot"
DEFAULT_HTTP_PORT=8080
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

issue_certificates() {
    local domain="$1"
    local email="$2"

    sudo mkdir -p "$CERTBOT_WEBROOT"

    if [[ -d "/etc/letsencrypt/live/${domain}" ]]; then
        log_success "  ✔ SSL-сертификат для ${domain} уже есть"
        return
    fi

    log_info "  Получение сертификата Let's Encrypt для ${domain}..."

    local temp_conf="/tmp/${PROJECT_NAME}_certbot.conf"
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
    log_success "  ✔ Сертификат получен"
}

create_env_file() {
    local domain="$1"
    local email="$2"
    local ssl_port="$3"
    local http_port="$4"

    local miniapp_url
    miniapp_url="$(url_with_port "$domain" "$ssl_port")"

    log_info "\nНастройка .env"

    local bot_token bot_username dent_id dent_secret

    if [[ -f ".env" ]] && grep -q '^telegram_bot_token=.' .env 2>/dev/null; then
        log_warn "  Найден существующий .env"
        if confirm "  Перезаписать .env полностью? (y/n): "; then
            :
        else
            # Обновить только URL/порты, остальное оставить
            if grep -q '^MINIAPP_URL=' .env; then
                sed -i "s|^MINIAPP_URL=.*|MINIAPP_URL=${miniapp_url}|" .env
            else
                echo "MINIAPP_URL=${miniapp_url}" >> .env
            fi
            if grep -q '^HTTP_PORT=' .env; then
                sed -i "s|^HTTP_PORT=.*|HTTP_PORT=${http_port}|" .env
            else
                echo "HTTP_PORT=${http_port}" >> .env
            fi
            if grep -q '^ENVIRONMENT=' .env; then
                sed -i "s|^ENVIRONMENT=.*|ENVIRONMENT=production|" .env
            else
                echo "ENVIRONMENT=production" >> .env
            fi
            chmod 600 .env 2>/dev/null || true
            log_success "  ✔ .env обновлён (MINIAPP_URL, HTTP_PORT, ENVIRONMENT)"
            return
        fi
    fi

    section "Telegram-бот"
    prompt_secret "  Токен бота (telegram_bot_token): " bot_token
    prompt "  Username бота без @ (esimker_bot): " bot_username_input
    bot_username="$(sanitize_bot_username "$bot_username_input")"

    if [[ -z "$bot_token" || -z "$bot_username" ]]; then
        log_error "Токен и username бота обязательны."
        exit 1
    fi

    section "DENT Giga Store (опционально)"
    hint "Оставьте пустым, если провайдер eSIM ещё не подключён"
    prompt "  dent_client_id: " dent_id
    prompt "  dent_client_secret: " dent_secret

    cat > .env <<EOF
# Telegram
telegram_bot_token=${bot_token}
telegram_bot_username=${bot_username}

# Public URL (HTTPS)
MINIAPP_URL=${miniapp_url}
DOMAIN=${domain}
SSL_EMAIL=${email}

# Runtime
ENVIRONMENT=production

# DENT Giga Store (optional)
dent_client_id=${dent_id}
dent_client_secret=${dent_secret}

# Database
DB_PATH=data/data.db

# API
API_HOST=0.0.0.0
API_PORT=8000
API_CORS_ORIGINS=
INIT_DATA_MAX_AGE_SECONDS=86400
API_RATE_LIMIT_PER_MINUTE=120

# Docker
HTTP_PORT=${http_port}

# Frontend build
VITE_TELEGRAM_BOT_USERNAME=${bot_username}
EOF

    chmod 600 .env
    log_success "  ✔ .env создан"
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
    local miniapp_url
    miniapp_url="$(url_with_port "$domain" "$ssl_port")"

    printf '\n'
    printf "${GREEN}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${NC}\n"
    printf "${GREEN}┃${NC}  🎉 ${BOLD}esimker установлен${NC} 🎉                              ${GREEN}┃${NC}\n"
    printf "${GREEN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${NC}\n"
    printf '\n'
    printf "  Мини-приложение:  ${YELLOW}%s${NC}\n" "$miniapp_url"
    printf "  API health:       ${YELLOW}%s/api/health${NC}\n" "$miniapp_url"
    printf '\n'
    printf "${BOLD}  Обязательно в @BotFather:${NC}\n"
    printf "  1. Bot Settings → Menu Button / Web App URL → ${CYAN}%s${NC}\n" "$miniapp_url"
    printf "  2. Bot Settings → Domain (Login Widget)   → ${CYAN}%s${NC}\n" "$domain"
    printf '\n'
    printf "${BOLD}  Полезные команды:${NC}\n"
    printf "  docker compose ps\n"
    printf "  docker compose logs -f api bot web\n"
    printf "  ./install.sh          # повторный запуск = обновление\n"
    printf '\n'
}

run_update() {
    log_info "Режим обновления (найден ${NGINX_CONF})"

    local http_port="$DEFAULT_HTTP_PORT"
    local domain=""
    if [[ -f ".env" ]]; then
        http_port="$(grep -m1 '^HTTP_PORT=' .env | cut -d= -f2- | tr -d '\r' || true)"
        http_port="${http_port:-$DEFAULT_HTTP_PORT}"
        domain="$(grep -m1 '^DOMAIN=' .env | cut -d= -f2- | tr -d '\r' || true)"
    fi
    HTTP_PORT="$http_port"

    start_containers

    if [[ -f "$NGINX_CONF" ]]; then
        sudo nginx -t && sudo systemctl reload nginx
    fi

    local domain="${DOMAIN:-}"
    if [[ -z "$domain" && -f ".env" ]]; then
        domain="$(grep -m1 '^DOMAIN=' .env | cut -d= -f2- | tr -d '\r' || true)"
    fi
    if [[ -n "$domain" ]]; then
        print_summary "$domain" "${SSL_PORT:-$DEFAULT_SSL_PORT}"
    else
        log_success "Обновление завершено."
    fi
}

run_install() {
    log_success "--- Установка esimker ---"

    ensure_packages
    ensure_services
    ensure_certbot_nginx

    log_info "\nШаг 2: домен и SSL"

    prompt "  Домен мини-приложения (app.example.com): " domain_input
    DOMAIN="$(sanitize_domain "$domain_input")"
    if [[ -z "$DOMAIN" ]]; then
        log_error "Некорректный домен."
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

    SERVER_IP="$(get_server_ip || true)"
    DOMAIN_IP="$(resolve_domain_ip "$DOMAIN" || true)"

    if [[ -n "$SERVER_IP" ]]; then
        log_info "  IP сервера: ${SERVER_IP}"
    fi
    if [[ -n "$DOMAIN_IP" ]]; then
        log_info "  IP домена ${DOMAIN}: ${DOMAIN_IP}"
    fi
    if [[ -n "$SERVER_IP" && -n "$DOMAIN_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
        log_warn "  DNS ${DOMAIN} не указывает на этот сервер."
        confirm "  Продолжить? (y/n): " || exit 1
    fi

    if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q 'Status: active'; then
        log_warn "  UFW активен — открываем 80 и ${SSL_PORT}"
        sudo ufw allow 80/tcp
        sudo ufw allow "${SSL_PORT}"/tcp
    fi

    issue_certificates "$DOMAIN" "$SSL_EMAIL"
    write_nginx_config "$DOMAIN" "$SSL_PORT" "$HTTP_PORT"
    create_env_file "$DOMAIN" "$SSL_EMAIL" "$SSL_PORT" "$HTTP_PORT"
    start_containers
    print_summary "$DOMAIN" "$SSL_PORT"
}

# ── Entry ────────────────────────────────────────────────────────────────────

require_project_root

if [[ -f "$NGINX_CONF" ]]; then
    run_update
else
    run_install
fi
