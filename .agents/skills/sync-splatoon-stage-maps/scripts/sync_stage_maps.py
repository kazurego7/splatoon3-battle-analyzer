#!/usr/bin/env python3
"""Safely check or refresh rule-specific Splatoon 3 stage map images."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from datetime import datetime
from urllib.parse import unquote, urljoin, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

INDEX_URL = "https://wikiwiki.jp/splatoon3mix/%E3%82%B9%E3%83%86%E3%83%BC%E3%82%B8"
RULES = ("ナワバリ", "エリア", "ヤグラ", "ホコ", "アサリ")
EXCLUDED_TERMS = ("ルート", "変更点", "カンモン", "ゴール", "旧", "改修前", "散歩")
USER_AGENT = "splatoon-battle-review-stage-sync/1.0"
CSV_FIELDS = (
    "stage_name", "rule_name", "source_page_url", "image_direct_url",
    "original_alt", "selected_version", "local_file", "bytes", "sha256",
)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[dict[str, str]] = []
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "img":
            src = values.get("data-src") or values.get("data-original") or values.get("src")
            if src:
                self.images.append({"src": src, "alt": values.get("alt", ""), "title": values.get("title", "")})
        elif tag == "a" and values.get("href"):
            self.links.append(values["href"])


def repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def fetch(url: str, timeout: int = 15, retries: int = 3) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,image/webp,*/*"})
    for attempt in range(retries):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise
            if attempt + 1 >= retries:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else min(2 ** (attempt + 1), 20)
            print(f"Source requested a pause; retrying in {delay:g}s ({attempt + 2}/{retries})")
            time.sleep(delay)
        except URLError:
            if attempt + 1 >= retries:
                raise
            delay = min(2 ** attempt, 8)
            print(f"Network request failed; retrying in {delay:g}s ({attempt + 2}/{retries})")
            time.sleep(delay)
    raise RuntimeError("unreachable")


def fetch_page(url: str) -> PageParser:
    parser = PageParser()
    parser.feed(fetch(url).decode("utf-8", errors="replace"))
    return parser


def decoded_name(url: str) -> str:
    value = html.unescape(unquote(urlparse(url).path.rsplit("/", 1)[-1]))
    return re.sub(r"\.(?:webp|png|jpe?g)(?:\.(?:webp|png|jpe?g))?$", "", value, flags=re.I)


def version_tuple(label: str) -> tuple[int, ...]:
    match = re.search(r"(?:ver(?:sion)?|v)[\s._-]*(\d+(?:[._-]\d+)*)", label, flags=re.I)
    if not match:
        return (0,)
    return tuple(int(part) for part in re.split(r"[._-]", match.group(1)))


def version_text(version: tuple[int, ...]) -> str:
    while len(version) > 1 and version[-1] == 0:
        version = version[:-1]
    return ".".join(str(part) for part in version)


def candidate_for(stage: str, rule: str, page_url: str, parser: PageParser) -> dict[str, object] | None:
    candidates: list[dict[str, object]] = []
    for order, image in enumerate(parser.images):
        direct_url = urljoin(page_url, html.unescape(image["src"]))
        source_name = decoded_name(direct_url)
        label = " ".join((source_name, image["alt"], image["title"]))
        if stage not in label or rule not in label:
            continue
        if any(term in label for term in EXCLUDED_TERMS):
            continue
        if not re.search(r"\.(?:webp|png|jpe?g)(?:\?|$)", direct_url, flags=re.I):
            continue
        version = version_tuple(label)
        timestamp = int((re.search(r"[?&]t=(\d+)", direct_url) or [None, "0"])[1])
        candidates.append({
            "url": direct_url,
            "source_name": image["alt"] or source_name,
            "version": version,
            "timestamp": timestamp,
            "order": order,
        })
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item["version"], item["timestamp"], item["order"]))


def read_rows(manifest: Path) -> list[dict[str, str]]:
    with manifest.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def known_pages(stage_root: Path) -> dict[str, str]:
    pages: dict[str, str] = {}
    manifest = stage_root / "map_urls.csv"
    if manifest.exists():
        for row in read_rows(manifest):
            pages[row["stage_name"]] = row["source_page_url"]
    missing = stage_root / "missing_rules.csv"
    if missing.exists():
        for row in read_rows(missing):
            pages[row["stage_name"]] = row["source_page_url"]
    return pages


def discover_pages(existing: dict[str, str]) -> dict[str, str]:
    parser = fetch_page(INDEX_URL)
    result = dict(existing)
    prefix = unquote(urlparse(INDEX_URL).path).rstrip("/") + "/"
    for href in parser.links:
        url = urljoin(INDEX_URL, href).split("#", 1)[0]
        path = unquote(urlparse(url).path)
        if not path.startswith(prefix) or path.count("/") != prefix.count("/"):
            continue
        stage = path.rsplit("/", 1)[-1]
        if stage and not any(term in stage for term in ("一覧", "情報", "コメント", "考察")):
            result.setdefault(stage, url)
    return result


def is_webp(data: bytes) -> bool:
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check(stage_root: Path) -> int:
    manifest = stage_root / "map_urls.csv"
    if not manifest.exists():
        print(f"ERROR: manifest not found: {manifest}", file=sys.stderr)
        return 2
    errors: list[str] = []
    hashes: dict[str, list[str]] = {}
    rows = read_rows(manifest)
    expected_names = set()
    for row in rows:
        relative = row["local_file"].replace("/", os.sep)
        path = stage_root / relative
        expected_names.add(path.name)
        if not path.is_file():
            errors.append(f"missing: {relative}")
            continue
        data = path.read_bytes()
        digest = sha256(data)
        if not is_webp(data):
            errors.append(f"not WebP: {relative}")
        if row.get("bytes") and int(row["bytes"]) != len(data):
            errors.append(f"size mismatch: {relative}")
        if row.get("sha256") and row["sha256"] != digest:
            errors.append(f"hash mismatch: {relative}")
        hashes.setdefault(digest, []).append(relative)
    actual_names = {path.name for path in (stage_root / "images").glob("*.webp")}
    for name in sorted(actual_names - expected_names):
        errors.append(f"unlisted image: images/{name}")
    for names in hashes.values():
        if len(names) > 1:
            errors.append(f"duplicate content: {', '.join(names)}")
    if errors:
        print("Stage map check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    missing_count = max(0, sum(1 for _ in read_rows(stage_root / "missing_rules.csv"))) if (stage_root / "missing_rules.csv").exists() else 0
    print(f"OK: {len(rows)} images verified; {missing_count} source omissions declared; no duplicates")
    return 0


def write_csv(path: Path, fields: tuple[str, ...], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, quoting=csv.QUOTE_ALL, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def sync(stage_root: Path, discover: bool, request_delay: float) -> int:
    pages = known_pages(stage_root)
    if discover:
        pages = discover_pages(pages)
    if not pages:
        print("ERROR: no source pages found", file=sys.stderr)
        return 2

    selected: list[tuple[str, str, str, dict[str, object]]] = []
    missing: list[dict[str, object]] = []
    for page_index, (stage, page_url) in enumerate(sorted(pages.items())):
        if page_index:
            time.sleep(request_delay)
        print(f"Inspecting {stage}")
        try:
            parser = fetch_page(page_url)
        except (HTTPError, URLError, TimeoutError) as error:
            print(f"ERROR: could not read {page_url}: {error}; existing assets were not changed", file=sys.stderr)
            return 1
        found = 0
        for rule in RULES:
            candidate = candidate_for(stage, rule, page_url, parser)
            if candidate:
                selected.append((stage, rule, page_url, candidate))
                found += 1
            else:
                missing.append({"stage_name": stage, "rule_name": rule, "source_page_url": page_url, "reason": "該当画像なし"})
        if discover and found == 0 and stage not in known_pages(stage_root):
            missing = [row for row in missing if row["stage_name"] != stage]

    if not selected:
        print("ERROR: source markup yielded no usable images; existing assets were not changed", file=sys.stderr)
        return 1

    stage_root.mkdir(parents=True, exist_ok=True)
    image_root = stage_root / "images"
    image_root.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="stage-map-sync-") as temp_name:
        temp_root = Path(temp_name)
        for stage, rule, page_url, candidate in selected:
            filename = f"{stage}_{rule}.webp"
            print(f"Downloading {filename}")
            try:
                data = fetch(str(candidate["url"]))
            except (HTTPError, URLError, TimeoutError) as error:
                print(f"ERROR: could not download {candidate['url']}: {error}; existing assets were not changed", file=sys.stderr)
                return 1
            if not is_webp(data):
                print(f"ERROR: source is not WebP: {candidate['url']}", file=sys.stderr)
                return 1
            (temp_root / filename).write_bytes(data)
            rows.append({
                "stage_name": stage,
                "rule_name": rule,
                "source_page_url": page_url,
                "image_direct_url": candidate["url"],
                "original_alt": candidate["source_name"],
                "selected_version": version_text(candidate["version"]),
                "local_file": f"images/{filename}",
                "bytes": len(data),
                "sha256": sha256(data),
            })

        duplicate_groups: dict[str, list[str]] = {}
        for row in rows:
            duplicate_groups.setdefault(str(row["sha256"]), []).append(str(row["local_file"]))
        duplicates = [names for names in duplicate_groups.values() if len(names) > 1]
        if duplicates:
            print(f"ERROR: duplicate downloads detected: {duplicates}", file=sys.stderr)
            return 1

        for staged in temp_root.glob("*.webp"):
            os.replace(staged, image_root / staged.name)

    write_csv(stage_root / "map_urls.csv", CSV_FIELDS, rows)
    write_csv(stage_root / "missing_rules.csv", ("stage_name", "rule_name", "source_page_url", "reason"), missing)
    summary = {
        "checked_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "index_url": INDEX_URL,
        "stage_count": len(pages),
        "expected_rule_images": len(pages) * len(RULES),
        "downloaded_images": len(rows),
        "missing_rule_images": len(missing),
        "duplicate_hash_groups": 0,
    }
    (stage_root / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {len(rows)} images; {len(missing)} source omissions recorded")
    return check(stage_root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "sync"))
    parser.add_argument("--root", type=Path, default=repository_root(), help="repository root")
    parser.add_argument("--discover", action="store_true", help="discover new stage pages from the index")
    parser.add_argument("--request-delay", type=float, default=0.75, help="seconds between source page requests")
    args = parser.parse_args()
    stage_root = args.root.resolve() / "assets" / "stage-maps"
    if args.command == "check":
        return check(stage_root)
    return sync(stage_root, args.discover, max(0.0, args.request_delay))


if __name__ == "__main__":
    raise SystemExit(main())
