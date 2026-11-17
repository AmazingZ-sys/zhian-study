#!/usr/bin/env python3
"""Export the local reference bank without changing its SQLite files.

Run from the repository root. See docs/QUESTION_BANK_MIGRATION.md.
Only Python's standard library is required.
"""
import argparse
import collections
import datetime
import hashlib
import html
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import urllib.parse
import uuid


SOURCE_KEY = "kaogong-shuati"
NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://zhian.study/question-bank/kaogong-shuati")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def stable_id(key):
    return str(uuid.uuid5(NAMESPACE, key))


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def readonly(path):
    connection = sqlite3.connect(Path(path).resolve().as_uri() + "?immutable=1&mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise ValueError(f"SQLite integrity check failed: {path}")
    return connection


class Images:
    def __init__(self, source_dir):
        self.source_dir = Path(source_dir)
        self.local = set()
        self.remote = collections.Counter()
        self.missing = collections.Counter()
        self.rejected = collections.Counter()

    def resolve(self, value):
        value = html.unescape(value or "").strip().strip("\\\"'")
        if value.startswith("//"):
            value = "https:" + value
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            self.rejected[value] += 1
            return None
        # Source CDN hosts differ between copies; they share the same image basename.
        name = Path(urllib.parse.unquote(parsed.path)).name
        if "/tarzan/images/" in parsed.path and re.fullmatch(r"[A-Za-z0-9._-]+", name):
            local = self.source_dir / name
            if local.is_file() and local.suffix.lower() in IMAGE_EXTENSIONS:
                self.local.add(name)
                return f"/api/v1/bank-assets/{name}"
            self.missing[name] += 1
        # Parentheses and whitespace must not terminate a Markdown image token.
        value = urllib.parse.quote(value, safe=":/?&=%#@+;,$!~*'-._")
        self.remote[value] += 1
        return value


class SafeMarkdown(HTMLParser):
    BLOCKS = {"p", "div", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"}
    SKIP = {"script", "style", "iframe", "object", "embed", "template", "noscript"}

    def __init__(self, images):
        super().__init__(convert_charrefs=True)
        self.images = images
        self.parts = []
        self.suppressed = []

    def handle_starttag(self, tag, attrs):
        if self.suppressed:
            if tag in self.SKIP:
                self.suppressed.append(tag)
            return
        if tag in self.SKIP:
            self.suppressed.append(tag)
            return
        attr = dict(attrs)
        if tag == "img":
            url = self.images.resolve(attr.get("src"))
            if url:
                alt = re.sub(r"[\[\]\r\n]", " ", attr.get("alt") or "图片").strip()
                self.parts.append(f"![{alt}]({url})")
        elif tag == "br":
            self.parts.append("\n")
        elif tag in self.BLOCKS:
            self.parts.append("\n\n")
        elif tag == "li":
            self.parts.append("\n• ")
        elif tag == "tr":
            self.parts.append("\n")
        elif tag in {"td", "th"}:
            self.parts.append("\t")
        elif tag == "sup":
            self.parts.append("^(")
        elif tag == "sub":
            self.parts.append("_(")

    def handle_endtag(self, tag):
        if self.suppressed:
            if tag == self.suppressed[-1]:
                self.suppressed.pop()
            return
        if tag in self.BLOCKS or tag in {"table", "ul", "ol"}:
            self.parts.append("\n\n")
        elif tag == "tr":
            self.parts.append("\n")
        elif tag in {"sup", "sub"}:
            self.parts.append(")")

    def handle_data(self, data):
        if not self.suppressed:
            self.parts.append(data.replace("\xa0", " "))

    def result(self):
        value = "".join(self.parts)
        value = re.sub(r"[ \t]+\n", "\n", value)
        return re.sub(r"\n{3,}", "\n\n", value).strip()


def markdown(value, images):
    if not value:
        return ""
    parser = SafeMarkdown(images)
    # Some upstream option HTML contains literally escaped attribute quotes.
    parser.feed(str(value).replace('\\"', '"'))
    parser.close()
    return parser.result()


def answer_indices(row):
    raw = str(row["answer"] or "").strip()
    if raw.startswith("["):
        values = json.loads(raw)
        if values and isinstance(values[0], list):
            values = values[0]
    elif raw and "," in raw:
        values = raw.split(",")
    elif row["answerIndex"] is not None and row["answerIndex"] >= 0:
        values = [row["answerIndex"]]
    elif raw:
        values = [raw]
    else:
        values = []
    # A malformed float or boolean must not silently become an index.
    if not isinstance(values, list) or any(isinstance(v, bool) or not re.fullmatch(r"\d+", str(v).strip()) for v in values):
        raise ValueError("invalid answer index")
    return [int(v) for v in values]


def normalize_question(row, images):
    kind = {1: "single", 2: "multiple", 3: "multiple", 5: "boolean"}.get(row["type"], "subjective")
    reason = None
    choices = []
    answers = []
    if kind != "subjective":
        try:
            raw_options = json.loads(row["options"] or "[]")
            if not isinstance(raw_options, list) or any(not isinstance(v, str) for v in raw_options):
                raise ValueError("options are not a string array")
            if kind == "boolean" and not raw_options:
                raw_options = ["正确", "错误"]
            choices = [markdown(value, images) for value in raw_options]
            indices = answer_indices(row)
            if not 2 <= len(choices) <= 8 or any(not v for v in choices):
                raise ValueError("invalid or empty options")
            if not indices or len(set(indices)) != len(indices) or any(v >= len(choices) for v in indices):
                raise ValueError("answer is outside option range")
            if kind != "multiple" and len(indices) != 1:
                raise ValueError("single-answer question has several answers")
            if kind == "boolean" and len(choices) != 2:
                raise ValueError("boolean question needs two options")
            answers = [chr(65 + v) for v in indices]
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            reason = str(error)
            kind, choices, answers = "subjective", [], []
    explanation = markdown(row["analysisHtml"] or row["analysis"], images)
    if kind == "subjective" and row["answer"]:
        reference = markdown(row["answer"], images)
        if reference and reference not in explanation:
            explanation = f"参考答案：\n{reference}\n\n{explanation}".strip()
    title = markdown(row["contentHtml"] or row["content"], images) or "（源题干为空，详见原始试卷记录）"
    if kind == "subjective":
        try:
            original_options = json.loads(row["options"] or "[]")
        except (ValueError, TypeError):
            original_options = [row["options"]] if row["options"] else []
        if isinstance(original_options, list) and original_options:
            readable_options = []
            for index, option in enumerate(original_options):
                if isinstance(option, dict):
                    # Subjective records often contain only an intOptionId and a null optionDesc.
                    # Preserve that metadata in raw, without showing it as a made-up choice.
                    option = option.get("optionDesc")
                    if not option:
                        continue
                text = markdown(str(option or ""), images) or "（源选项内容缺失）"
                label = chr(65 + index) if index < 26 else str(index + 1)
                readable_options.append(f"{label}. {text}")
            if readable_options:
                title += "\n\n原始选项（不参与判分）：\n" + "\n".join(readable_options)
    return {
        "title": title,
        "type": kind,
        "options": [{"key": chr(65 + i), "text": text} for i, text in enumerate(choices)],
        "correctAnswer": answers,
        "explanation": explanation or "源题库暂未提供参考解析。",
        "difficulty": max(1, min(5, math.ceil((row["difficulty"] or 3) / 2))),
    }, reason


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_line(stream, value):
    stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def export(args):
    source_dir = args.source.resolve()
    output = args.output.resolve()
    if output == source_dir or source_dir in output.parents:
        raise ValueError("Output must be outside the reference project")
    if output.exists() and any(output.iterdir()) and not args.overwrite:
        raise ValueError("Output directory is not empty; use --overwrite for an explicit re-export")
    output.mkdir(parents=True, exist_ok=True)
    snapshots = output / "snapshots"
    snapshots.mkdir(exist_ok=True)
    image_dir = output / "assets"
    image_dir.mkdir(exist_ok=True)
    inputs = {"tiku.db": args.tiku.resolve(), "materials.db": source_dir / "materials.db", "tiku-index.db": source_dir / "tiku-index.db"}
    connections = {name: readonly(path) for name, path in inputs.items()}
    tiku, material_db, index = (connections[key] for key in inputs)
    try:
        revision = subprocess.check_output(["git", "-C", str(source_dir), "rev-parse", "HEAD"], text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        revision = "unknown-local-snapshot"
    try:
        remote = subprocess.check_output(["git", "-C", str(source_dir), "remote", "get-url", "origin"], text=True, stderr=subprocess.DEVNULL).strip()
        if remote.startswith("git@") and ":" in remote:
            remote = "https://" + remote[4:].replace(":", "/", 1)
        parsed_remote = urllib.parse.urlsplit(remote)
        source_url = urllib.parse.urlunsplit((parsed_remote.scheme, parsed_remote.hostname or "", parsed_remote.path.removesuffix(".git"), "", "")) if parsed_remote.scheme in {"http", "https"} else source_dir.as_uri()
    except (subprocess.CalledProcessError, FileNotFoundError):
        source_url = source_dir.as_uri()
    images = Images(source_dir / "public" / "tarzan-img")
    paper_rows = [dict(row) for row in tiku.execute("SELECT * FROM papers ORDER BY id")]
    paper_by_id = {row["id"]: row for row in paper_rows}
    category_index = {(r["subject"], r["question_id"]): (r["category"], r["sub"]) for r in index.execute("SELECT * FROM question_categories")}
    material_index = {(r["subject"], r["material_id"]): r["content"] for r in index.execute("SELECT * FROM q_materials")}
    material_map = {(r["subject"], r["question_id"]): r["material_id"] for r in index.execute("SELECT * FROM q_material_map WHERE material_id IS NOT NULL")}
    paper_materials = collections.defaultdict(list)
    for row in material_db.execute("SELECT * FROM materials ORDER BY paperId,idx,title"):
        if row["paperId"] in paper_by_id:
            try:
                idx = int(row["idx"]) if row["idx"] is not None else None
            except (ValueError, TypeError):
                idx = None
            paper_materials[row["paperId"]].append({"title": row["title"] or "材料", "text": markdown(row["text"], images), "pdf": row["pdf"] or "", "idx": idx})
    categories = {}

    def get_category(subject, board, sub):
        parent = None
        path = []
        for name in dict.fromkeys(v for v in (subject, board, sub) if v):
            path.append(name)
            label = " / ".join(path)
            if label not in categories:
                categories[label] = {"id": stable_id("category:" + label), "name": label, "subject": subject if parent is None else board or subject, "parentId": parent, "sort": len(categories)}
            parent = categories[label]["id"]
        return parent

    source_id = stable_id("source:" + SOURCE_KEY)
    seen = set()
    counts = collections.Counter()
    by_subject = collections.defaultdict(collections.Counter)
    downgrades = []
    payloads = {name: (output / (name + ".jsonl")).open("w", encoding="utf-8") for name in ["questions", "papers", "paper-questions"]}
    actual_paper_counts = dict(tiku.execute("SELECT paperId,COUNT(*) FROM questions GROUP BY paperId").fetchall())
    positions = collections.Counter()
    try:
        for row in tiku.execute("SELECT * FROM questions ORDER BY id"):
            raw = dict(row)
            paper = paper_by_id[row["paperId"]]
            subject = paper["subjectName"] or paper["subject"]
            short_subject = subject.split("·")[-1]
            key = f"{SOURCE_KEY}:{subject}:{row['questionId']}"
            question_id = stable_id(key)
            positions[row["paperId"]] += 1
            write_line(payloads["paper-questions"], {"id": stable_id(f"paper-question:{row['paperId']}:{positions[row['paperId']]}") , "paperId": stable_id(f"paper:{row['paperId']}"), "questionId": question_id, "position": positions[row["paperId"]], "raw": raw})
            counts["paperQuestions"] += 1
            if key in seen:
                continue
            seen.add(key)
            board, sub = category_index.get((subject, row["questionId"]), category_index.get((short_subject, row["questionId"]), (row["chapter"] or "未分类", "")))
            board = board or row["chapter"] or "未分类"
            normalized, reason = normalize_question(row, images)
            material_id = material_map.get((subject, row["questionId"]), material_map.get((short_subject, row["questionId"])))
            material = material_index.get((subject, material_id), material_index.get((short_subject, material_id), "")) if material_id is not None else ""
            material = markdown(material, images)
            material_kind = "index" if material else "none"
            if not material:
                material = "\n\n".join(f"{item['title']}\n{item['text']}" for item in paper_materials[row["paperId"]] if item["text"])
                if material:
                    material_kind = "paper"
            year_match = re.match(r"((?:19|20)\d{2})", paper["name"] or "")
            normalized.update({"id": question_id, "externalKey": key, "examType": subject, "subject": board, "categoryId": get_category(subject, board, sub), "material": material, "tags": list(dict.fromkeys(v for v in (short_subject, board, sub, row["questionType"]) if v))[:20], "sourceId": source_id, "sourceLabel": paper["name"] or "参考项目题库", "status": "pending", "enabled": True, "year": int(year_match[1]) if year_match else None, "imageUrl": None})
            for option in normalized["options"]:
                option["id"] = stable_id(f"{key}:option:{option['key']}")
            write_line(payloads["questions"], normalized)
            counts["questions"] += 1
            counts["objective" if normalized["type"] != "subjective" else "subjective"] += 1
            counts["options"] += len(normalized["options"])
            by_subject[subject]["questions"] += 1
            by_subject[subject][normalized["type"]] += 1
            by_subject[subject]["material:" + material_kind] += 1
            if reason:
                downgrades.append({"externalKey": key, "reason": reason})
        for paper in paper_rows:
            year = re.match(r"((?:19|20)\d{2})", paper["name"] or "")
            write_line(payloads["papers"], {"id": stable_id(f"paper:{paper['id']}"), "externalKey": f"{SOURCE_KEY}:paper:{paper['id']}", "sourceId": source_id, "title": paper["name"] or f"试卷 {paper['id']}", "subject": paper["subjectName"] or paper["subject"], "category": paper["category"] or "", "year": int(year[1]) if year else None, "questionCount": actual_paper_counts.get(paper["id"], 0), "materials": paper_materials[paper["id"]], "raw": paper})
            counts["papers"] += 1
    finally:
        for stream in payloads.values():
            stream.close()
        for connection in connections.values():
            connection.close()
    with (output / "categories.jsonl").open("w", encoding="utf-8") as stream:
        for row in categories.values():
            write_line(stream, row)
    counts["categories"] = len(categories)
    counts["referencedLocalImages"] = len(images.local)
    available_images = {path.name for path in images.source_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS and re.fullmatch(r"[A-Za-z0-9._-]+", path.name)}
    counts["localImages"] = len(available_images)
    for name in sorted(available_images):
        shutil.copy2(images.source_dir / name, image_dir / name)
    source_files = {}
    for name, path in inputs.items():
        shutil.copy2(path, snapshots / name)
        source_files[name] = {"bytes": path.stat().st_size, "sha256": digest(path), "md5": digest(path, "md5")}
    for pattern in ("README*", "LICENSE*", "COPYING*", "NOTICE*"):
        for path in sorted(source_dir.glob(pattern)):
            if path.is_file():
                name = "source-" + path.name
                shutil.copy2(path, snapshots / name)
                source_files[name] = {"bytes": path.stat().st_size, "sha256": digest(path), "md5": digest(path, "md5")}
    payload_files = {name: {"bytes": (output / name).stat().st_size, "sha256": digest(output / name)} for name in ["categories.jsonl", "questions.jsonl", "papers.jsonl", "paper-questions.jsonl"]}
    manifest = {"formatVersion": 1, "sourceKey": SOURCE_KEY, "sourceId": source_id, "sourceRevision": revision, "sourceUrl": source_url, "exportedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "sourcePath": str(source_dir), "counts": dict(counts), "subjects": dict(by_subject), "sourceFiles": source_files, "files": payload_files}
    write_json(output / "manifest.json", manifest)
    write_json(output / "report.json", {"counts": dict(counts), "subjects": dict(by_subject), "downgradedQuestions": downgrades, "missingLocalImages": dict(sorted(images.missing.items())), "remoteImages": dict(sorted(images.remote.items())), "rejectedImageUrls": dict(sorted(images.rejected.items()))})
    (output / "README.md").write_text(f"# 本地参考题库导出\n\n来源：{source_dir}\n\n源版本：{revision}\n\n导出时间：{manifest['exportedAt']}\n\n此目录是个人部署数据包，未逐题人工核验。保留原始 SQLite 快照、原始试卷题目行、来源信息与图片。此记录不授予上游未授予的权利。\n\n共 {counts['questions']:,} 道去重题、{counts['papers']:,} 份试卷、{counts['paperQuestions']:,} 条原始试卷记录。可计分客观题 {counts['objective']:,} 道，主观/参考题 {counts['subjective']:,} 道。\n\nassets/ 中图片由 API 的 QUESTION_BANK_ASSET_DIR 指向。未缓存的远程图（包含公式图）保留 HTTPS/HTTP 地址，见 report.json；离线环境不能保证这些图可用。原始快照保留在 snapshots/，不要放进公开静态目录。manifest.json 含源文件和导入文件 SHA-256。\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "counts": dict(counts), "remoteImageUrls": len(images.remote), "missingLocalImageNames": len(images.missing)}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Reference project directory")
    parser.add_argument("--tiku", type=Path, required=True, help="Reassembled tiku.db outside reference repo")
    parser.add_argument("--output", type=Path, default=Path("data/question-bank"))
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    try:
        export(args)
    except (OSError, ValueError, sqlite3.Error) as error:
        print(f"Export failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
