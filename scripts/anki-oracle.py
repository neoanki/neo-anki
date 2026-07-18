#!/usr/bin/env python3
"""Generate disposable migration fixtures and inspect packages with pinned Anki.

This script intentionally uses only generated content. It never opens a user's
profile and is suitable for CI with `anki==25.9.4`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path

from anki.collection import (
    CardIdsLimit,
    Collection,
    DeckIdLimit,
    ExportAnkiPackageOptions,
    ImportAnkiPackageOptions,
    ImportAnkiPackageRequest,
)
from anki.scheduler_pb2 import CardAnswer

PINNED_ANKI_VERSION = "25.9.4"


def add_note(col: Collection, model_name: str, fields: dict[str, str], deck_id: int, tags: list[str]) -> int:
    note = col.new_note(col.models.by_name(model_name))
    for name, value in fields.items():
        note[name] = value
    note.tags = tags
    col.add_note(note, deck_id)
    return note.id


def generated_collection(path: Path, *, large_media: bool = False) -> tuple[Collection, int]:
    col = Collection(str(path))
    deck_id = col.decks.add_normal_deck_with_name("Migration Corpus::Core").id
    config = col.decks.add_config("Migration continuity")
    config["new"]["delays"] = [2.0, 15.0]
    config["new"]["perDay"] = 7
    config["rev"]["perDay"] = 77
    config["rev"]["maxIvl"] = 1234
    config["lapse"]["delays"] = [8.0, 30.0]
    config["lapse"]["leechFails"] = 5
    config["lapse"]["leechAction"] = 1
    config["desiredRetention"] = 0.91
    col.decks.update_config(config)
    deck = col.decks.get(deck_id)
    col.decks.set_config_id_for_deck_dict(deck, config["id"])
    col.decks.update(deck)

    custom = col.models.new("Migration Custom")
    for name in ("Prompt", "Answer", "Hint"):
        col.models.add_field(custom, col.models.new_field(name))
    forward = col.models.new_template("Forward")
    forward["qfmt"] = '<section class="prompt">{{Prompt}}</section>{{type:Answer}}'
    forward["afmt"] = '{{FrontSide}}<hr><section class="answer">{{Answer}}</section><small>{{Hint}}</small>'
    reverse = col.models.new_template("Reverse")
    reverse["qfmt"] = '<section class="answer">{{Answer}}</section>'
    reverse["afmt"] = '{{FrontSide}}<hr><section class="prompt">{{Prompt}}</section>'
    col.models.add_template(custom, forward)
    col.models.add_template(custom, reverse)
    custom["css"] = ".card { color: #123456; background: #fefefe; } .prompt { font-weight: 700; }"
    col.models.add(custom)

    col.media.write_data("migration-pixel.png", b"\x89PNG\r\n\x1a\nneo-anki-generated")
    large_sound_tags = ""
    if large_media:
        for index in range(32):
            filename = f"migration-large-{index:02d}.mp3"
            col.media.write_data(filename, b"ID3" + hashlib.shake_256(f"neo-anki-large-media-{index}".encode()).digest(256 * 1024 - 3))
            large_sound_tags += f"[sound:{filename}]"
    add_note(
        col,
        "Migration Custom",
        {"Prompt": f'Capital of <b>France</b>?<img src="migration-pixel.png">{large_sound_tags}', "Answer": "Paris", "Hint": "A European capital"},
        deck_id,
        ["geography", "generated"],
    )
    add_note(col, "Basic (and reversed card)", {"Front": "uno", "Back": "one"}, deck_id, ["language"])
    add_note(col, "Basic (type in the answer)", {"Front": "2 + 2", "Back": "4"}, deck_id, ["typed"])
    add_note(col, "Cloze", {"Text": "{{c1::Retrieval practice::method}} and {{c2::spacing::timing}} improve learning.", "Back Extra": "Generated corpus"}, deck_id, ["cloze", "pedagogy"])

    card_ids = col.find_cards('deck:"Migration Corpus::Core"')
    col.decks.select(deck_id)
    queued = col.sched.get_queued_cards(fetch_limit=50)
    if queued.cards:
        queued_card = queued.cards[0]
        card = col.get_card(queued_card.card.id)
        card.start_timer()
        answer = col.sched.build_answer(card=card, states=queued_card.states, rating=CardAnswer.Rating.GOOD)
        col.sched.answer_card(answer)
        reviewed = col.get_card(card.id)
        reviewed.due = int(time.time()) - 1
        col.update_card(reviewed)
    if len(card_ids) > 1:
        col.sched.suspend_cards([card_ids[1]])
        col.set_user_flag_for_cards(3, [card_ids[1]])
    if len(card_ids) > 2:
        col.sched.bury_cards([card_ids[2]])
    return col, deck_id


def generate(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="neo-anki-corpus-") as directory:
        col, deck_id = generated_collection(Path(directory) / "collection.anki2")
        options = ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=True, legacy=False)
        col.export_anki_package(out_path=str(output / "current-stable.apkg"), options=options, limit=DeckIdLimit(deck_id=deck_id))
        legacy = ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=True, legacy=True)
        col.export_anki_package(out_path=str(output / "legacy-schema.apkg"), options=legacy, limit=DeckIdLimit(deck_id=deck_id))
        col.export_collection_package(str(output / "current-stable.colpkg"), include_media=True, legacy=False)
        col.close()
    manifest = {
        "generator": "scripts/anki-oracle.py",
        "ankiVersion": PINNED_ANKI_VERSION,
        "files": {
            path.name: {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}
            for path in sorted(output.glob("*.?olpkg")) + sorted(output.glob("*.apkg"))
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def generate_large(package: Path) -> None:
    package.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="neo-anki-large-corpus-") as directory:
        col, deck_id = generated_collection(Path(directory) / "collection.anki2", large_media=True)
        options = ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=True, legacy=False)
        col.export_anki_package(out_path=str(package), options=options, limit=DeckIdLimit(deck_id=deck_id))
        col.close()


def inspect_package(package: Path) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="neo-anki-oracle-") as directory:
        col = Collection(os.path.join(directory, "collection.anki2"))
        request = ImportAnkiPackageRequest(
            package_path=str(package),
            options=ImportAnkiPackageOptions(merge_notetypes=True, with_scheduling=True, with_deck_configs=True),
        )
        col.import_anki_package(request)
        card_ids = col.find_cards("")
        note_ids = col.find_notes("")
        media = sorted(Path(col.media.dir()).glob("*"))
        sample = []
        for card_id in card_ids[:10]:
            card = col.get_card(card_id)
            sample.append({
                "id": card_id,
                "noteId": card.nid,
                "deckId": card.did,
                "ordinal": card.ord,
                "queue": card.queue,
                "due": card.due,
                "interval": card.ivl,
                "reps": card.reps,
                "flags": card.user_flag(),
                "question": card.question(reload=True),
                "answer": card.answer(),
            })
        result = {
            "ankiVersion": PINNED_ANKI_VERSION,
            "notes": len(note_ids),
            "cards": len(card_ids),
            "reviews": int(col.db.scalar("select count() from revlog") or 0),
            "noteTypes": len(col.models.all_names_and_ids()),
            "decks": len(col.decks.all_names_and_ids()),
            "media": [{"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in media if path.is_file()],
            "sample": sample,
        }
        col.close()
        return result


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    generate_parser = subparsers.add_parser("generate")
    generate_parser.add_argument("output", type=Path)
    large_parser = subparsers.add_parser("generate-large")
    large_parser.add_argument("package", type=Path)
    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("package", type=Path)
    args = parser.parse_args()
    if args.command == "generate":
        generate(args.output)
    elif args.command == "generate-large":
        generate_large(args.package)
    else:
        print(json.dumps(inspect_package(args.package), ensure_ascii=False))


if __name__ == "__main__":
    main()
