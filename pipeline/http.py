"""Throttled, retrying HTTP downloads for NASA FIRMS.

Design notes
------------
* Credentials are passed in URLs by the FIRMS web services. Every URL that is
  logged, stored in a manifest or raised in an exception has the secret
  redacted with ``***``.
* Downloads stream to ``<name>.part`` and are renamed only when complete, so a
  failed transfer never looks like a finished raw file.
* ``Range`` resume is attempted when a partial file exists. If the server
  ignores the range request, the file restarts from zero.
"""

from __future__ import annotations

import hashlib
import http.client
import random
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import urlsplit

USER_AGENT = "Agnidrishti-FIRMS-pipeline/1.0 (+NASA Space Apps Challenge 2026)"
RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504}
REDACTED = "***"


class DownloadError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


@dataclass
class DownloadResult:
    url: str
    path: Path
    http_status: int
    bytes_written: int
    sha256: str
    last_modified: str | None
    etag: str | None
    content_type: str | None
    resumed: bool


@dataclass
class HeadResult:
    url: str
    status: int
    headers: dict[str, str]


def redact(text: str, secrets: Iterable[str | None]) -> str:
    redacted = text
    for secret in secrets:
        if secret:
            redacted = redacted.replace(secret, REDACTED)
    return redacted


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Downloader:
    def __init__(
        self,
        *,
        timeout: float = 120.0,
        retries: int = 4,
        throttle_seconds: float = 1.0,
        secrets: Iterable[str | None] = (),
    ) -> None:
        self.timeout = timeout
        self.retries = retries
        self.throttle_seconds = throttle_seconds
        self.secrets = [value for value in secrets if value]
        self._last_request_at = 0.0

    # -- internals ---------------------------------------------------------
    def _clean(self, text: str) -> str:
        return redact(text, self.secrets)

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.throttle_seconds:
            time.sleep(self.throttle_seconds - elapsed)

    def _request(self, url: str, headers: dict[str, str], method: str):
        self._throttle()
        request = urllib.request.Request(url, headers=headers, method=method)
        try:
            response = urllib.request.urlopen(request, timeout=self.timeout)
        finally:
            self._last_request_at = time.monotonic()
        return response

    def _with_retries(self, description: str, action):
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                return action()
            except urllib.error.HTTPError as error:
                body = ""
                try:
                    body = error.read(2048).decode("utf-8", "replace").strip()
                except Exception:  # noqa: BLE001 - body is diagnostic only
                    body = ""
                message = f"{description} failed: HTTP {error.code}"
                if body:
                    message += f" - {self._clean(body)[:500]}"
                if error.code not in RETRY_STATUS or attempt == self.retries:
                    raise DownloadError(message, status=error.code) from None
                last_error = error
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as error:
                reason = getattr(error, "reason", error)
                last_error = error
                if attempt == self.retries:
                    raise DownloadError(
                        self._clean(f"{description} failed after retries: {reason}")
                    ) from None
            except http.client.IncompleteRead as error:
                last_error = error
                if attempt == self.retries:
                    raise DownloadError(f"{description} failed: incomplete read") from None

            backoff = min(60.0, 2.0**attempt) + random.uniform(0, 0.75)
            print(
                f"  retry {attempt + 1}/{self.retries} in {backoff:.1f}s "
                f"({type(last_error).__name__ if last_error else 'error'})"
            )
            time.sleep(backoff)

        raise DownloadError(f"{description} failed")  # pragma: no cover

    # -- public API --------------------------------------------------------
    def get_text(self, url: str, *, headers: dict[str, str] | None = None) -> str:
        merged = {"User-Agent": USER_AGENT, "Accept": "text/csv, text/plain, */*"}
        merged.update(headers or {})

        def action() -> str:
            with self._request(url, merged, "GET") as response:
                return response.read().decode("utf-8", "replace")

        return self._with_retries(f"GET {self._clean(url)}", action)

    def head(self, url: str) -> HeadResult:
        clean = self._clean(url)

        def action() -> HeadResult:
            with self._request(url, {"User-Agent": USER_AGENT}, "HEAD") as response:
                return HeadResult(
                    url=clean,
                    status=response.status,
                    headers={key.lower(): value for key, value in response.headers.items()},
                )

        return self._with_retries(f"HEAD {clean}", action)

    def download(
        self,
        url: str,
        destination: Path,
        *,
        headers: dict[str, str] | None = None,
        allow_empty: bool = False,
    ) -> DownloadResult:
        destination.parent.mkdir(parents=True, exist_ok=True)
        partial = destination.with_suffix(destination.suffix + ".part")
        clean_url = self._clean(url)

        if partial.exists() and partial.stat().st_size == 0:
            partial.unlink()

        resumed = partial.exists() and partial.stat().st_size > 0
        base_headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
        base_headers.update(headers or {})

        def action() -> DownloadResult:
            request_headers = dict(base_headers)
            offset = partial.stat().st_size if (resumed and partial.exists()) else 0
            if offset:
                request_headers["Range"] = f"bytes={offset}-"

            with self._request(url, request_headers, "GET") as response:
                status = response.status
                mode = "ab" if status == 206 and offset else "wb"
                with partial.open(mode) as handle:
                    while True:
                        chunk = response.read(1024 * 512)
                        if not chunk:
                            break
                        handle.write(chunk)
                return DownloadResult(
                    url=clean_url,
                    path=destination,
                    http_status=status,
                    bytes_written=partial.stat().st_size,
                    sha256="",
                    last_modified=response.headers.get("Last-Modified"),
                    etag=response.headers.get("ETag"),
                    content_type=response.headers.get("Content-Type"),
                    resumed=bool(status == 206 and offset),
                )

        result = self._with_retries(f"GET {clean_url}", action)

        if result.bytes_written == 0 and not allow_empty:
            partial.unlink(missing_ok=True)
            raise DownloadError(f"{clean_url} returned an empty file")

        if destination.exists():
            expected = destination.stat().st_size
            if result.bytes_written != expected and result.http_status == 200:
                # A previous complete file was replaced; that is intentional.
                pass

        partial.replace(destination)
        result.sha256 = file_sha256(destination)
        return result


def parse_last_modified(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError):
        return None


def describe_url(url: str) -> str:
    """Safe URL for logs: host and path only, no query string."""

    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"
