"""DENT (Giga Store) eSIM Reseller API client — OpenAPI 1.3.5."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, TypedDict

import httpx

BASE_URL = "https://api.giga.store"


class SortDir(StrEnum):
    DESC = "DESC"
    ASC = "ASC"


class ProductsInventorySortKey(StrEnum):
    AMOUNT = "AMOUNT"
    NAME = "NAME"
    VOLUME = "VOLUME"
    VALIDITY = "VALIDITY"
    PRICE = "PRICE"
    RETAILPRICE = "RETAILPRICE"


class ProductsActivatedItemsSortKey(StrEnum):
    DATE = "DATE"
    NAME = "NAME"
    VOLUME = "VOLUME"
    VALIDITY = "VALIDITY"
    PRICE = "PRICE"
    RETAILPRICE = "RETAILPRICE"
    SALESCHANNEL = "SALESCHANNEL"


class ActivationMode(StrEnum):
    NOW = "NOW"
    FIRST_USE = "FIRST_USE"
    ON_DEMAND = "ON_DEMAND"


class CustomerSearchKey(StrEnum):
    EMAIL = "EMAIL"
    UID = "UID"
    ICCID = "ICCID"


class CustomerSearchMode(StrEnum):
    IS_EXACT = "isExact"
    STARTS_WITH = "startsWith"
    CONTAINS = "contains"


class DentAPIError(Exception):
    """Raised when the DENT API returns a non-success response."""

    def __init__(
        self,
        status_code: int,
        message: str,
        *,
        problem: dict[str, Any] | None = None,
        response_body: Any = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.problem = problem
        self.response_body = response_body


class Price(TypedDict, total=False):
    sortIndex: int
    priceValue: float
    currencyCode: Literal["USD"]


class UpdateInventoryItemRequest(TypedDict, total=False):
    name: str
    retailPrice: Price


class BaseActivateRequest(TypedDict, total=False):
    inventoryItemId: str
    metatag: str
    userCountry: str
    userIp: str
    expectedPrice: Price
    activationMode: str


class ActivateRequest(BaseActivateRequest, total=False):
    customerEmail: str


class ActivateRequestForExistingCustomer(BaseActivateRequest, total=False):
    customerUid: str
    customerProfileDomainId: str


class ActivateRequestForExistingCustomerWithProfile(
    ActivateRequestForExistingCustomer, total=False
):
    dedicated: bool


class ResellerCustomerSearchRequest(TypedDict, total=False):
    pageSize: int
    pageIndex: int
    searchKey: str
    searchQuery: str
    searchMode: str
    onlyActiveProfiles: bool


class UpdateCustomerDetailsRequest(TypedDict, total=False):
    customerEmail: str
    countryOfResidence: str


@dataclass
class _TokenState:
    access_token: str = ""
    expires_at: float = 0.0


@dataclass
class DentClient:
    """Async client for the DENT eSIM Reseller API."""

    client_id: str
    client_secret: str
    base_url: str = BASE_URL
    timeout: float = 30.0
    _token: _TokenState = field(default_factory=_TokenState, repr=False)
    _http: httpx.AsyncClient | None = field(default=None, repr=False)

    @classmethod
    def from_env(
        cls,
        *,
        client_id_var: str = "dent_client_id",
        client_secret_var: str = "dent_client_secret",
        base_url: str = BASE_URL,
        timeout: float = 30.0,
    ) -> DentClient:
        client_id = os.getenv(client_id_var, "").strip()
        client_secret = os.getenv(client_secret_var, "").strip()
        if not client_id or not client_secret:
            raise ValueError(
                f"{client_id_var} and {client_secret_var} must be set in the environment"
            )
        return cls(
            client_id=client_id,
            client_secret=client_secret,
            base_url=base_url,
            timeout=timeout,
        )

    async def __aenter__(self) -> DentClient:
        await self._get_http()
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def close(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self.base_url.rstrip("/"),
                timeout=self.timeout,
            )
        return self._http

    async def authenticate(self) -> dict[str, Any]:
        """POST /reseller/authenticate — obtain a bearer token (Basic auth)."""
        http = await self._get_http()
        response = await http.post(
            "/reseller/authenticate",
            auth=(self.client_id, self.client_secret),
        )
        data = self._parse_response(response)
        access_token = data.get("accessToken", "")
        expires_in = int(data.get("expiresIn", 0))
        self._token.access_token = access_token
        self._token.expires_at = time.monotonic() + max(expires_in - 30, 0)
        return data

    async def _ensure_token(self) -> str:
        if self._token.access_token and time.monotonic() < self._token.expires_at:
            return self._token.access_token
        await self.authenticate()
        return self._token.access_token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        auth: bool = True,
    ) -> Any:
        http = await self._get_http()
        request_headers = dict(headers or {})
        if auth:
            token = await self._ensure_token()
            request_headers["Authorization"] = f"Bearer {token}"

        response = await http.request(
            method,
            path,
            params=params,
            json=json,
            headers=request_headers or None,
        )
        return self._parse_response(response)

    @staticmethod
    def _parse_response(response: httpx.Response) -> Any:
        if response.is_success:
            if not response.content:
                return None
            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type or "application/problem+json" in content_type:
                return response.json()
            return response.content

        body: Any = None
        problem: dict[str, Any] | None = None
        message = f"HTTP {response.status_code}"
        content_type = response.headers.get("content-type", "")

        try:
            if "application/json" in content_type or "application/problem+json" in content_type:
                body = response.json()
                if isinstance(body, dict):
                    problem = body if "type" in body or "title" in body else None
                    message = str(
                        body.get("message")
                        or body.get("detail")
                        or body.get("title")
                        or message
                    )
            else:
                text = response.text.strip()
                if text:
                    message = text
                    body = text
        except Exception:
            body = response.text or None

        raise DentAPIError(
            response.status_code,
            message,
            problem=problem,
            response_body=body,
        )

    # --- Inventory ---

    async def get_inventory_items(
        self,
        *,
        sort_dir: SortDir | str | None = None,
        sort_by: ProductsInventorySortKey | str | None = None,
    ) -> dict[str, Any]:
        """GET /gigastore/products/inventory."""
        params: dict[str, Any] = {}
        if sort_dir is not None:
            params["sort_dir"] = str(sort_dir)
        if sort_by is not None:
            params["sort_by"] = str(sort_by)
        return await self._request("GET", "/gigastore/products/inventory", params=params)

    async def get_inventory_item(self, item_id: str) -> dict[str, Any]:
        """GET /gigastore/products/inventory/{id}."""
        return await self._request("GET", f"/gigastore/products/inventory/{item_id}")

    async def update_inventory_item(
        self,
        item_id: str,
        body: UpdateInventoryItemRequest,
    ) -> dict[str, Any]:
        """PUT /gigastore/products/inventory/{id}."""
        return await self._request(
            "PUT",
            f"/gigastore/products/inventory/{item_id}",
            json=dict(body),
        )

    # --- Activations ---

    async def register(
        self,
        body: ActivateRequest,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """POST /gigastore/activations/register — new customer + eSIM profile."""
        headers = self._idempotency_headers(idempotency_key)
        return await self._request(
            "POST",
            "/gigastore/activations/register",
            json=dict(body),
            headers=headers,
        )

    async def top_up_with_profile(
        self,
        body: ActivateRequestForExistingCustomerWithProfile,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """POST /gigastore/activations/top-up-with-profile."""
        headers = self._idempotency_headers(idempotency_key)
        return await self._request(
            "POST",
            "/gigastore/activations/top-up-with-profile",
            json=dict(body),
            headers=headers,
        )

    async def top_up(
        self,
        body: ActivateRequestForExistingCustomer,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """POST /gigastore/activations/top-up — existing customer, no new profile."""
        headers = self._idempotency_headers(idempotency_key)
        return await self._request(
            "POST",
            "/gigastore/activations/top-up",
            json=dict(body),
            headers=headers,
        )

    async def get_activated_items(
        self,
        *,
        from_date: str | None = None,
        to_date: str | None = None,
        sort_dir: SortDir | str | None = None,
        sort_by: ProductsActivatedItemsSortKey | str | None = None,
    ) -> list[dict[str, Any]]:
        """GET /gigastore/activations/activated-items."""
        params: dict[str, Any] = {}
        if from_date is not None:
            params["from"] = from_date
        if to_date is not None:
            params["to"] = to_date
        if sort_dir is not None:
            params["sort_dir"] = str(sort_dir)
        if sort_by is not None:
            params["sort_by"] = str(sort_by)
        result = await self._request(
            "GET",
            "/gigastore/activations/activated-items",
            params=params,
        )
        return result if isinstance(result, list) else []

    async def get_activated_item(
        self,
        uid: str,
        *,
        only_active_profiles: bool = True,
    ) -> dict[str, Any]:
        """GET /gigastore/activations/activated-items/{uid}."""
        return await self._request(
            "GET",
            f"/gigastore/activations/activated-items/{uid}",
            params={"only_active_profiles": only_active_profiles},
        )

    async def enable_activated_item(self, uid: str) -> dict[str, Any]:
        """POST /gigastore/activations/activated-items/{uid}/activate."""
        return await self._request(
            "POST",
            f"/gigastore/activations/activated-items/{uid}/activate",
        )

    async def refund_activated_item(self, uid: str) -> None:
        """POST /activations/activated-items/{uid}/refund."""
        await self._request("POST", f"/activations/activated-items/{uid}/refund")

    # --- Customers ---

    async def search_customers(
        self,
        body: ResellerCustomerSearchRequest,
    ) -> dict[str, Any]:
        """POST /gigastore/activations/search-customers."""
        return await self._request(
            "POST",
            "/gigastore/activations/search-customers",
            json=dict(body),
        )

    async def get_customers(
        self,
        *,
        page_size: int = 50,
        page_index: int = 0,
        only_active_profiles: bool = True,
    ) -> dict[str, Any]:
        """GET /gigastore/activations/customers."""
        return await self._request(
            "GET",
            "/gigastore/activations/customers",
            params={
                "page_size": page_size,
                "page_index": page_index,
                "only_active_profiles": only_active_profiles,
            },
        )

    async def get_customer(
        self,
        customer_uid: str,
        *,
        only_active_profiles: bool = True,
    ) -> dict[str, Any]:
        """GET /gigastore/activations/customers/{customer_uid}."""
        return await self._request(
            "GET",
            f"/gigastore/activations/customers/{customer_uid}",
            params={"only_active_profiles": only_active_profiles},
        )

    async def update_customer(
        self,
        customer_uid: str,
        body: UpdateCustomerDetailsRequest,
    ) -> dict[str, Any]:
        """PUT /gigastore/activations/customers/{customer_uid}."""
        return await self._request(
            "PUT",
            f"/gigastore/activations/customers/{customer_uid}",
            json=dict(body),
        )

    async def get_customer_profile_domains(
        self,
        customer_uid: str,
        *,
        only_active_profiles: bool = True,
    ) -> dict[str, Any]:
        """GET /gigastore/activations/customers/{customer_uid}/profile-domains."""
        return await self._request(
            "GET",
            f"/gigastore/activations/customers/{customer_uid}/profile-domains",
            params={"only_active_profiles": only_active_profiles},
        )

    # --- eSIM / misc ---

    async def get_version(self) -> dict[str, Any]:
        """GET /gigastore/version."""
        return await self._request("GET", "/gigastore/version", auth=False)

    async def get_countries(
        self,
        country_set: str,
        *,
        locale: str | None = None,
    ) -> list[dict[str, Any]]:
        """GET /gigastore/esim/countries/{countrySet}."""
        headers = {"Locale": locale} if locale else None
        result = await self._request(
            "GET",
            f"/gigastore/esim/countries/{country_set}",
            headers=headers,
        )
        return result if isinstance(result, list) else []

    async def get_country_flag(self, country_code: str) -> bytes:
        """GET /gigastore/esim/countries/{countryCode}/flag — PNG bytes."""
        result = await self._request(
            "GET",
            f"/gigastore/esim/countries/{country_code}/flag",
        )
        return result if isinstance(result, bytes) else b""

    async def get_esim_connectivity(self, iccid: str) -> dict[str, Any]:
        """GET /gigastore/esim/{iccid}/status/connectivity."""
        return await self._request(
            "GET",
            f"/gigastore/esim/{iccid}/status/connectivity",
        )

    @staticmethod
    def _idempotency_headers(idempotency_key: str | None) -> dict[str, str] | None:
        if not idempotency_key:
            return None
        return {"idempotency-key": idempotency_key[:64]}
