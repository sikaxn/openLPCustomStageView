"""Create the page 15 controls for the four controlled stage views.

Uses Companion's live tRPC editor through the sibling companion-mcp client.
Existing, unrelated page 15 buttons are never overwritten.
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPANION_MCP_SRC = ROOT.parent / "companion-mcp" / "src"
if not COMPANION_MCP_SRC.is_dir():
    raise SystemExit(f"companion-mcp is required at {COMPANION_MCP_SRC}")
sys.path.insert(0, str(COMPANION_MCP_SRC))

from companion_mcp.client import CompanionClient  # noqa: E402
from companion_mcp.config import CompanionConfig  # noqa: E402


VIEWS = (
    ("banner-controlled", "Banner"),
    ("overhead-controlled", "Overhead"),
    ("vmixOverlay-controlled", "vMix Bottom"),
    ("vmixcenter-controlled", "vMix Center"),
)
PAGE = 15


def action(variable: str, value: str, expression: bool = False) -> tuple[str, str, bool]:
    return variable, value, expression


def expected_buttons() -> list[tuple[int, int, str, list[tuple[str, str, bool]], int]]:
    buttons = []
    for row, (folder, label) in enumerate(VIEWS):
        config = json.loads((ROOT / folder / "config.json").read_text(encoding="utf-8"))
        prefix = f"stage_{config['screen_id']}_"
        buttons.extend(
            [
                (row, 1, f"{label}\nLyrics", [action(prefix + "mode", "lyrics")], 0x176544),
                (row, 2, f"{label}\nTitle", [action(prefix + "mode", "title")], 0x225B87),
                (row, 3, f"{label}\nBlank", [action(prefix + "mode", "blank")], 0x822A34),
                (row, 4, f"{label}\nSource 0", [action(prefix + "source", "0")], 0x4B5056),
                (row, 5, f"{label}\npySSP 1", [action(prefix + "source", "1")], 0x306D73),
            ]
        )
    screen_ids = [
        json.loads((ROOT / folder / "config.json").read_text(encoding="utf-8"))["screen_id"]
        for folder, _label in VIEWS
    ]
    mode_variables = [f"stage_{screen_id}_mode" for screen_id in screen_ids]
    source_variables = [f"stage_{screen_id}_source" for screen_id in screen_ids]
    buttons.append((0, 7, "ALL\nLyrics", [action(name, "lyrics") for name in mode_variables], 0x176544))
    buttons.append((1, 7, "ALL\nTitle", [action(name, "title") for name in mode_variables], 0x225B87))
    buttons.append((2, 7, "ALL\nBlank", [action(name, "blank") for name in mode_variables], 0x822A34))
    buttons.append((0, 8, "ALL\nSource 0", [action(name, "0") for name in source_variables], 0x4B5056))
    buttons.append((1, 8, "ALL\npySSP 1", [action(name, "1") for name in source_variables], 0x306D73))
    buttons.append(
        (3, 6, "Refresh\nAll Views", [action("stage_force_refresh", "$(custom:stage_force_refresh) * 1 + 1", True)], 0x603C81)
    )
    return buttons


def check(result: dict, label: str):
    if not result.get("ok") or result.get("body") not in (None, True, "ok"):
        raise RuntimeError(f"{label}: {result.get('error') or result.get('body')}")
    return result.get("body")


async def mutate(client: CompanionClient, path: str, payload: dict):
    result = await client.trpc_call("mutation", path, input=payload)
    check(result, path)


async def page_controls(client: CompanionClient) -> dict:
    result = await client.get_pages_snapshot()
    if not result.get("ok"):
        raise RuntimeError(f"Could not inspect Companion pages: {result.get('error')}")
    snapshot = result["body"]
    if len(snapshot["order"]) < PAGE:
        raise RuntimeError("Companion page 15 is missing")
    page = snapshot["pages"][snapshot["order"][PAGE - 1]]
    if page["name"] != "Custom Stage View Control":
        raise RuntimeError(f"Unexpected page 15 name: {page['name']}")
    return page["controls"]


async def ensure_variable(client: CompanionClient, name: str, default: str, description: str, persistent: bool):
    current = await client.get_custom_variable_current(name)
    if not current.get("ok"):
        raise RuntimeError(f"Could not inspect {name}: {current.get('error')}")
    if not current["body"]["exists"]:
        await mutate(client, "customVariables.create", {"name": name, "defaultVal": default})
    await mutate(client, "customVariables.setDescription", {"name": name, "description": description})
    if persistent:
        await mutate(client, "customVariables.setPersistence", {"name": name, "value": True})


def current_text(config: dict) -> str | None:
    for layer in config.get("style", {}).get("layers", []):
        if layer.get("id") == "text0":
            return layer.get("text", {}).get("value")
    return None


def current_actions(config: dict) -> list[dict]:
    return config.get("steps", {}).get("0", {}).get("action_sets", {}).get("down", [])


def feedback_spec(specs: list[tuple[str, str, bool]]) -> tuple[str, dict, int] | None:
    if len(specs) == 1 and specs[0][0] == "stage_force_refresh":
        return None
    value = specs[0][1]
    active_colors = {
        "lyrics": 0x36D978,
        "title": 0x53B4F5,
        "blank": 0xFF6473,
        "0": 0xD2E0EE,
        "1": 0x3BDACB,
    }
    if value not in active_colors or any(item[1] != value or item[2] for item in specs):
        raise RuntimeError(f"Cannot make feedback for actions {specs!r}")
    if len(specs) == 1:
        return "variable_value", {
            "variable": {"value": f"custom:{specs[0][0]}", "isExpression": False},
            "op": {"value": "eq", "isExpression": False},
            "value": {"value": value, "isExpression": False},
        }, active_colors[value]
    expression = " && ".join(f"$(custom:{name}) == {json.dumps(value)}" for name, _value, _expression in specs)
    return "check_expression", {
        "expression": {"value": expression, "isExpression": True},
    }, active_colors[value]


async def ensure_feedback(client: CompanionClient, control_id: str, row: int, column: int, specs: list[tuple[str, str, bool]]):
    expected = feedback_spec(specs)
    snapshot = await client.get_control_snapshot(control_id)
    if not snapshot.get("ok"):
        raise RuntimeError(f"Could not inspect feedback on page 15 button {row}/{column}")
    feedbacks = snapshot["body"]["config"].get("feedbacks", [])
    if expected is None:
        if feedbacks:
            raise RuntimeError(f"Unexpected feedback on page 15 button {row}/{column}")
        return
    definition, options, active_color = expected
    if len(feedbacks) > 1:
        raise RuntimeError(f"Unexpected feedback count on page 15 button {row}/{column}")
    if feedbacks:
        feedback = feedbacks[0]
        if feedback.get("connectionId") != "internal" or feedback.get("definitionId") != definition:
            raise RuntimeError(f"Unexpected feedback on page 15 button {row}/{column}")
        for key, value in options.items():
            actual = feedback.get("options", {}).get(key)
            if actual and actual != value:
                raise RuntimeError(f"Unexpected feedback option on page 15 button {row}/{column}: {key}")
        feedback_id = feedback["id"]
    else:
        result = await client.trpc_call(
            "mutation",
            "controls.entities.add",
            input={
                "controlId": control_id,
                "entityLocation": "feedbacks",
                "ownerId": None,
                "connectionId": "internal",
                "entityType": "feedback",
                "entityDefinition": definition,
            },
        )
        if not result.get("ok") or not result.get("body"):
            raise RuntimeError(f"Could not add feedback to page 15 button {row}/{column}: {result.get('error')}")
        feedback_id = result["body"]

    for key, value in options.items():
        await mutate(client, "controls.entities.setOption", {
            "controlId": control_id, "entityLocation": "feedbacks", "entityId": feedback_id,
            "key": key, "value": value,
        })

    snapshot = await client.get_control_snapshot(control_id)
    if not snapshot.get("ok"):
        raise RuntimeError(f"Could not inspect feedback style on page 15 button {row}/{column}")
    feedback = next((item for item in snapshot["body"]["config"].get("feedbacks", []) if item.get("id") == feedback_id), None)
    if not feedback:
        raise RuntimeError(f"Feedback missing on page 15 button {row}/{column}")
    for element, color in (("box0", active_color), ("text0", 0x111111)):
        matches = [
            item for item in feedback.get("styleOverrides", [])
            if item.get("elementId") == element and item.get("elementProperty") == "color"
        ]
        override_id = matches[0]["overrideId"] if matches else uuid.uuid4().hex
        await mutate(client, "controls.entities.replaceStyleOverride", {
            "controlId": control_id, "entityLocation": "feedbacks", "entityId": feedback_id,
            "override": {
                "overrideId": override_id, "elementId": element, "elementProperty": "color",
                "override": {"value": color, "isExpression": False},
            },
        })
        for duplicate in matches[1:]:
            await mutate(client, "controls.entities.removeStyleOverride", {
                "controlId": control_id, "entityLocation": "feedbacks", "entityId": feedback_id,
                "overrideId": duplicate["overrideId"],
            })


async def remove_old_button(client: CompanionClient, row: int, column: int, old_text: str, replacement_text: str | None = None):
    controls = await page_controls(client)
    control_id = controls.get(str(row), {}).get(str(column))
    if not control_id:
        return
    snapshot = await client.get_control_snapshot(control_id)
    if not snapshot.get("ok"):
        raise RuntimeError(f"Could not inspect old button {row}/{column}")
    text = current_text(snapshot["body"]["config"])
    if text == replacement_text:
        return
    if text != old_text:
        raise RuntimeError(f"Page 15 button {row}/{column} belongs to something else; stopping")
    await mutate(
        client,
        "controls.resetControls",
        {"locations": [{"pageNumber": PAGE, "row": row, "column": column}], "newType": None},
    )
    print(f"Removed page 15: {row}/{column} {old_text.replace(chr(10), ' ')}")


async def ensure_button(client: CompanionClient, row: int, column: int, text: str, specs: list[tuple[str, str, bool]], color: int):
    controls = await page_controls(client)
    control_id = controls.get(str(row), {}).get(str(column))
    if control_id:
        snapshot = await client.get_control_snapshot(control_id)
        if not snapshot.get("ok"):
            raise RuntimeError(f"Could not inspect button {row}/{column}")
        config = snapshot["body"]["config"]
        if config.get("type") != "button-layered" or current_text(config) != text:
            raise RuntimeError(f"Page 15 button {row}/{column} belongs to something else; stopping")
    else:
        await mutate(
            client,
            "controls.resetControls",
            {"locations": [{"pageNumber": PAGE, "row": row, "column": column}], "newType": "button-layered"},
        )
        controls = await page_controls(client)
        control_id = controls.get(str(row), {}).get(str(column))
        if not control_id:
            raise RuntimeError(f"Could not create page 15 button {row}/{column}")
        config = None

    async def style(element: str, key: str, value):
        await mutate(
            client,
            "controls.styles.updateOption",
            {"controlId": control_id, "elementId": element, "key": key, "value": {"value": value, "isExpression": False}},
        )

    await style("text0", "text", text)
    await style("text0", "fontsize", 28)
    await style("box0", "color", color)

    if config is None:
        snapshot = await client.get_control_snapshot(control_id)
        config = snapshot["body"]["config"]
    actions = current_actions(config)
    for index, existing in enumerate(actions):
        if index >= len(specs) or existing.get("definitionId") != "custom_variable_set_value":
            raise RuntimeError(f"Unexpected action on page 15 button {row}/{column}")
        options = existing.get("options", {})
        variable, value, expression = specs[index]
        actual = (
            options.get("name", {}).get("value"),
            options.get("value", {}).get("value"),
            options.get("value", {}).get("isExpression"),
        )
        if actual != (variable, value, expression):
            raise RuntimeError(f"Unexpected action options on page 15 button {row}/{column}")

    for variable, value, expression in specs[len(actions):]:
        result = await client.trpc_call(
            "mutation",
            "controls.entities.add",
            input={
                "controlId": control_id,
                "entityLocation": {"stepId": "0", "setId": "down"},
                "ownerId": None,
                "connectionId": "internal",
                "entityType": "action",
                "entityDefinition": "custom_variable_set_value",
            },
        )
        if not result.get("ok") or not result.get("body"):
            raise RuntimeError(f"Could not add action to {row}/{column}: {result.get('error') or result.get('body')}")
        entity_id = result["body"]
        for key, option in {
            "name": {"value": variable, "isExpression": False},
            "create": {"value": False, "isExpression": False},
            "value": {"value": value, "isExpression": expression},
        }.items():
            await mutate(
                client,
                "controls.entities.setOption",
                {"controlId": control_id, "entityLocation": {"stepId": "0", "setId": "down"}, "entityId": entity_id, "key": key, "value": option},
            )
    await ensure_feedback(client, control_id, row, column, specs)


async def main():
    client = CompanionClient(CompanionConfig())
    await page_controls(client)
    for folder, _label in VIEWS:
        config = json.loads((ROOT / folder / "config.json").read_text(encoding="utf-8"))
        prefix = f"stage_{config['screen_id']}_"
        await ensure_variable(client, prefix + "mode", "lyrics", f"{config['screen_name']} display: lyrics, title, or blank", True)
        await ensure_variable(client, prefix + "source", "0", f"{config['screen_name']} source ID from config.json", True)
    await ensure_variable(client, "stage_force_refresh", "0", "Change to reload all four controlled stage pages", False)
    for row, (_folder, label) in enumerate(VIEWS):
        await remove_old_button(client, row, 5, f"{label}\nSource +", f"{label}\npySSP 1")
        await remove_old_button(client, row, 7 if row == 3 else 6, f"{label}\npySSP 1")
    for row, column, text, specs, color in expected_buttons():
        await ensure_button(client, row, column, text, specs, color)
        print(f"Configured page 15: {row}/{column} {text.replace(chr(10), ' ')}")


if __name__ == "__main__":
    asyncio.run(main())
