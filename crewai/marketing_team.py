"""CrewAI marketing team runner used by the local Libra workspace."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

RESULT_PREFIX = "__CREWAI_RESULT__"
MAX_REVISIONS = 3

def emit(payload: dict[str, Any]) -> None:
    print(RESULT_PREFIX + json.dumps(payload, ensure_ascii=False), flush=True)


def emit_event(payload: dict[str, Any]) -> None:
    print("__CREWAI_EVENT__" + json.dumps(payload, ensure_ascii=False), flush=True)


def verify_required_changes(
    required_changes: list[dict[str, str]],
    change_checks: Any,
    deliverable: str,
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    checks_by_id: dict[str, dict[str, Any]] = {}
    duplicate_check_ids: set[str] = set()
    if isinstance(change_checks, list):
        for check in change_checks:
            if not isinstance(check, dict) or not isinstance(check.get("id"), str):
                continue
            check_id = check["id"]
            if check_id in checks_by_id:
                duplicate_check_ids.add(check_id)
            checks_by_id[check_id] = check

    normalize_quote = lambda value: " ".join(str(value).split()).casefold()
    normalized_content = normalize_quote(deliverable)
    unresolved_changes: list[dict[str, str]] = []
    verified_checks: list[dict[str, Any]] = []
    for change in required_changes:
        check = checks_by_id.get(change["id"])
        evidence = str(check.get("evidence", "")).strip() if check else ""
        evidence_is_present = len(normalize_quote(evidence)) >= 8 and normalize_quote(evidence) in normalized_content
        addressed = bool(
            check
            and change["id"] not in duplicate_check_ids
            and check.get("addressed") is True
            and evidence_is_present
        )
        verified_checks.append({
            "id": change["id"],
            "text": change["text"],
            "addressed": addressed,
            "evidence": evidence[:500] if addressed else "",
        })
        if not addressed:
            unresolved_changes.append(change)
    return unresolved_changes, verified_checks


def load_agents() -> list[dict[str, str]]:
    path = Path(os.environ.get("TEAM_AGENTS_FILE", Path(__file__).resolve().parents[1] / "data" / "team-agents.json"))
    agents = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(agents, list) or [agent.get("id") for agent in agents] != ["researcher", "strategist", "planner", "creative", "copywriter", "gtm"]:
        raise ValueError("The saved team must contain five specialists followed by the Go-To-Market Lead.")
    return agents


def status() -> int:
    try:
        import crewai

        payload = {
            "installed": True,
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "crewaiVersion": getattr(crewai, "__version__", "installed"),
        }
    except Exception as error:  # Keep diagnostics useful if an optional dependency is broken.
        payload = {"installed": False, "error": str(error)[:400]}
    emit(payload)
    return 0


def run(brief: dict[str, str]) -> int:
    if not os.environ.get("OPENAI_API_KEY"):
        emit({"error": "Add OPENAI_API_KEY to the local .env file, restart the app, and try again."})
        return 2

    try:
        from crewai import Agent, Crew, LLM, Process, Task

        model = os.environ.get("OPENAI_MODEL", "openai/gpt-4o-mini")
        llm = LLM(model=model, temperature=0.45)
        brand = brief["brand"].strip()
        objective = brief["objective"].strip()
        audience = brief["audience"].strip()
        market = brief.get("market", "").strip() or "Not specified"
        offer = brief.get("offer", "").strip() or "Not specified"
        channels = brief.get("channels", "").strip() or "Recommend appropriate channels"
        tone = brief.get("tone", "").strip() or "Clear, relevant, and brand-appropriate"
        constraints = brief.get("constraints", "").strip() or "No additional constraints supplied"
        timeline = brief.get("timelineContext", "").strip() or "No existing timeline item selected"

        brief_text = (
            f"Brand/product/campaign: {brand}\n"
            f"Objective: {objective}\n"
            f"Audience: {audience}\n"
            f"Market and context: {market}\n"
            f"Offer or key benefit: {offer}\n"
            f"Priority channels: {channels}\n"
            f"Desired tone: {tone}\n"
            f"Timeline context: {timeline}\n"
            f"Constraints, proof points, and extra context: {constraints}\n\n"
            "Work only from the supplied facts. Clearly label assumptions, do not invent research, statistics, customer quotes, product capabilities, or legal/compliance claims, and call out information that needs verification."
        )

        agent_profiles = load_agents()
        profile_by_id = {profile["id"]: profile for profile in agent_profiles}

        specialists = ["researcher", "strategist", "planner", "creative", "copywriter"]
        agents_by_id = {
            agent_id: Agent(
                role=profile_by_id[agent_id]["role"],
                goal=profile_by_id[agent_id]["goal"],
                backstory=profile_by_id[agent_id]["backstory"],
                llm=llm,
                allow_delegation=False,
                verbose=False,
            )
            for agent_id in [*specialists, "gtm"]
        }
        outputs: list[dict[str, Any]] = []
        review_history: list[dict[str, Any]] = []

        acceptance_criteria = {
            "researcher": "Source discipline, brief fidelity, useful distinctions between facts and hypotheses, audience relevance, risks, and open questions.",
            "strategist": "Clear alignment to the objective and audience, consistency with approved research, one coherent proposition, usable message hierarchy, and no unsupported proof or claims.",
            "planner": "A feasible sequence aligned to approved strategy, requested channels and timing, complete deliverables, dependencies, and no invented dates or owners presented as facts.",
            "creative": "A distinctive concept consistent with the approved strategy and plan, channel relevance, requested tone, and claims within supplied proof.",
            "copywriter": "Every requested content asset is inventoried and written in usable form, with channel/format/CTA/variants as relevant; content matches the approved strategy and plan and uses placeholders for unverified details.",
        }

        def upstream_context(agent_id: str) -> str:
            upstream = {
                "researcher": [],
                "strategist": ["researcher"],
                "planner": ["researcher", "strategist"],
                "creative": ["strategist", "planner"],
                "copywriter": ["researcher", "strategist", "planner", "creative"],
            }[agent_id]
            sections = []
            for output in outputs:
                if output["id"] in upstream:
                    sections.append(f"## Approved work — {output['agent']}\n{output['content'][:12000]}")
            return "\n\n".join(sections) or "No upstream deliverables yet."

        task_instructions = {
            "researcher": (
                "Create a concise research and opportunity memo. Separate supplied facts from hypotheses. Identify audience needs, relevant market/context implications, language considerations, opportunities, assumptions, risks, and questions to validate. Do not claim external research was performed.",
                "Markdown with Known facts, Audience needs, Opportunities, Assumptions to validate, Risks, and Open questions.",
            ),
            "strategist": (
                f"Define a focused campaign strategy for {brand}. State an audience insight, proposition, positioning, message hierarchy, proof required, and creative guardrails. Align every recommendation to the objective: {objective}.",
                "Markdown with audience insight, proposition, positioning, message hierarchy, proof requirements, and creative guardrails.",
            ),
            "planner": (
                f"Create an integrated rollout for {brand}. Preferred channels: {channels}. Include phases, timing, channel roles, all key deliverables, purpose, dependencies/owners by function, and timeline integration. Do not invent calendar dates when none are provided; clearly mark a suggested sequence.",
                "Markdown rollout with phase, timing, channel, activity, purpose, deliverables, and dependencies.",
            ),
            "creative": (
                f"Develop an ownable creative platform for {brand} based on the approved strategy and rollout. Desired tone: {tone}. Include central idea, rationale, channel-specific executions, and creative guardrails. Do not make claims beyond supplied proof.",
                "Markdown creative platform, rationale, channel executions, and claim-safe example headlines/supporting lines.",
            ),
            "copywriter": (
                f"Produce the actual content assets requested across the brief and approved campaign plan for {brand}; do not merely describe assets or provide a content strategy. First create a deliverables checklist by channel and format, then write every listed asset in full (including requested post variants, email subject/preheader/body/CTA, blog sections, landing-page copy, webinar/email assets, or other plan deliverables as applicable). Match the approved strategy and creative platform, use the desired tone ({tone}), and use clear [PLACEHOLDER: ...] markers wherever product facts, proof, links, offer details, legal review, or localization are missing. Never fabricate testimonials, statistics, product capabilities, or legal claims.",
                "Markdown with a deliverables checklist followed by complete channel-ready copy for every requested asset, labelled by channel, format, audience/phase, and CTA where relevant.",
            ),
        }

        for agent_id in specialists:
            profile = profile_by_id[agent_id]
            upstream = upstream_context(agent_id)
            base_description, expected_output = task_instructions[agent_id]
            accepted = False
            final_content = ""
            stage_reviews = []
            required_changes: list[dict[str, str]] = []

            for iteration in range(1, MAX_REVISIONS + 2):
                emit_event({
                    "type": "agent_started",
                    "agentId": agent_id,
                    "name": profile["name"],
                    "iteration": iteration,
                    "isRevision": iteration > 1,
                })
                revision_note = ""
                if stage_reviews:
                    open_corrections = "\n".join(
                        f"- [{change['id']}] {change['text']}" for change in required_changes
                    ) or "No previously open correction remains."
                    revision_note = (
                        "\n\nGO-TO-MARKET LEAD REQUIRED CORRECTIONS — revise this deliverable directly; do not just explain changes.\n"
                        "Address every open correction below. Preserve already-correct content. Do not claim a correction is done unless the deliverable itself reflects it.\n"
                        "Open corrections carried forward (none may be silently dropped):\n"
                        + open_corrections
                        + "\nLatest reviewer feedback:\n"
                        + stage_reviews[-1]["feedback"]
                        + "\nIssues: "
                        + json.dumps(stage_reviews[-1]["issues"], ensure_ascii=False)
                        + "\nPrevious draft to correct:\n"
                        + final_content[:18000]
                    )
                description = (
                    f"{base_description}\n\nSOURCE BRIEF AND FACTS:\n{brief_text}\n\n"
                    f"APPROVED UPSTREAM WORK:\n{upstream}{revision_note}"
                )
                task = Task(description=description, expected_output=expected_output, agent=agents_by_id[agent_id])
                result = Crew(
                    agents=[agents_by_id[agent_id]],
                    tasks=[task],
                    process=Process.sequential,
                    verbose=False,
                    memory=False,
                ).kickoff(inputs={"brand": brand, "objective": objective, "audience": audience})
                final_content = str(getattr(result, "raw", result)).strip()[:38000]
                emit_event({"type": "agent_completed", "agentId": agent_id, "name": profile["name"], "iteration": iteration})
                emit_event({
                    "type": "review_started",
                    "agentId": "gtm",
                    "targetAgentId": agent_id,
                    "targetName": profile["name"],
                    "iteration": iteration,
                })

                required_changes_text = json.dumps(required_changes, ensure_ascii=False)
                correction_review_instruction = (
                    "\nOPEN CORRECTIONS FROM EARLIER PASSES (every ID must be checked):\n"
                    f"{required_changes_text}\n"
                    "For every listed correction, return one change_checks entry with the exact id, addressed boolean, and evidence copied verbatim from the current deliverable. "
                    "Mark addressed true only when the deliverable itself resolves the correction; otherwise mark false. Evidence must be an exact excerpt, not a paraphrase. "
                    "Do not approve while any listed material correction remains unresolved. Keep its original ID; do not restate it as a new issue or progressively raise its specificity bar.\n"
                    if required_changes else ""
                )

                review_task = Task(
                    description=(
                        f"Review the following {profile['name']} deliverable against this acceptance criteria: {acceptance_criteria[agent_id]}\n\n"
                        f"Review the original brief and relevant upstream approved deliverables for consistency.\n\n"
                        f"ORIGINAL BRIEF:\n{brief_text}\n\nUPSTREAM APPROVED WORK:\n{upstream}\n\n"
                        f"DELIVERABLE TO REVIEW:\n{final_content[:24000]}\n\n"
                        "Block only on a material defect: a missed explicit brief requirement, contradiction with approved work, unsupported affirmative claim, meaningful safety/compliance risk, or unusable/incomplete deliverable. "
                        "Do not block on optional detail, stylistic preference, or a request for greater specificity once the substance is adequate. Do not move the goalposts across passes. "
                        "The brief is the evidence boundary: never demand research, legal/regulatory specifics, statistics, proof, or product facts that were not supplied. For missing information, a clearly labeled assumption, open question, or [VERIFY]/[PLACEHOLDER] is a complete and safe treatment; do not request invented specifics. "
                        "Use issues only for new, actionable blocking defects not already represented by an open correction ID. Put optional improvements in suggestions. If prior feedback is adequately addressed at a reasonable level, mark it addressed true and approve. "
                        "If rejecting, tell the specialist the minimum concrete change that would close the blocker. Reply with exactly one JSON object using schema: "
                        '{"approved": true, "feedback": "...", "issues": ["blocking issue"], "suggestions": ["optional improvement"], "change_checks": [{"id": "...", "addressed": true, "evidence": "verbatim excerpt"}]}. '
                        "approved must be a JSON boolean; issues and suggestions must be arrays of strings; change_checks must include every requested correction ID exactly once. "
                        "Use an empty change_checks array when no prior corrections were supplied. When approved, issues must be []."
                        + correction_review_instruction
                    ),
                    expected_output='One JSON object: {"approved": boolean, "feedback": "specific feedback or approval note", "issues": ["blocking issue"], "suggestions": ["optional improvement"], "change_checks": [{"id": "correction-id", "addressed": boolean, "evidence": "verbatim excerpt"}]}.',
                    agent=agents_by_id["gtm"],
                )
                review_result = Crew(
                    agents=[agents_by_id["gtm"]],
                    tasks=[review_task],
                    process=Process.sequential,
                    verbose=False,
                    memory=False,
                ).kickoff(inputs={"brand": brand, "objective": objective, "audience": audience})
                review_text = str(getattr(review_result, "raw", review_result)).strip()
                json_start = review_text.find("{")
                json_end = review_text.rfind("}")
                if json_start < 0 or json_end <= json_start:
                    raise ValueError("Go-To-Market Lead returned a review without the required structured JSON decision.")
                review = json.loads(review_text[json_start:json_end + 1])
                if type(review.get("approved")) is not bool:
                    raise ValueError("Go-To-Market Lead review is missing a boolean approval decision.")
                feedback = str(review.get("feedback", "")).strip()[:4000]
                issues = [str(issue)[:1000] for issue in review.get("issues", [])[:12]] if isinstance(review.get("issues", []), list) else []
                suggestions = [str(suggestion)[:1000] for suggestion in review.get("suggestions", [])[:12]] if isinstance(review.get("suggestions", []), list) else []
                original_issues = list(issues)
                unresolved_changes, verified_checks = verify_required_changes(
                    required_changes,
                    review.get("change_checks", []),
                    final_content,
                )
                for change in unresolved_changes:
                    issues.append(f"{change['id']} remains unverified: {change['text']}")

                if review["approved"] and issues:
                    feedback = (feedback + " " if feedback else "") + "Approval was withheld because the review still lists unresolved issues."
                if unresolved_changes:
                    feedback = (feedback + " " if feedback else "") + "Approval was withheld because one or more earlier corrections were not verified in the revised deliverable."
                if not review["approved"] and not issues and not unresolved_changes:
                    approved = True
                    if feedback:
                        suggestions.append(feedback)
                    feedback = "No material blocking issue was identified; remaining feedback is recorded as a non-blocking suggestion."
                else:
                    approved = review["approved"] and not issues and not unresolved_changes
                if not approved and not feedback and not issues:
                    feedback = "Revise the deliverable to meet the stated acceptance criteria, then resubmit it for Go-To-Market review."
                review_entry = {
                    "agentId": agent_id,
                    "agent": profile["name"],
                    "iteration": iteration,
                    "approved": approved,
                    "feedback": feedback,
                    "issues": issues,
                    "suggestions": suggestions,
                    "changeChecks": verified_checks,
                }
                stage_reviews.append(review_entry)
                review_history.append(review_entry)
                emit_event({
                    "type": "review_completed",
                    "agentId": "gtm",
                    "targetAgentId": agent_id,
                    "targetName": profile["name"],
                    "iteration": iteration,
                    "approved": approved,
                    "feedback": feedback,
                    "issues": issues,
                    "suggestions": suggestions,
                    "changeChecks": verified_checks,
                })
                if approved:
                    accepted = True
                    break
                if iteration <= MAX_REVISIONS:
                    required_changes = unresolved_changes
                    new_corrections = original_issues if not unresolved_changes else []
                    if not new_corrections and not unresolved_changes and feedback:
                        new_corrections = [feedback]
                    for issue_index, correction in enumerate(new_corrections, start=1):
                        required_changes.append({
                            "id": f"{agent_id}-r{iteration}-i{issue_index}",
                            "text": correction[:1000],
                        })
                    emit_event({
                        "type": "correction_requested",
                        "agentId": agent_id,
                        "name": profile["name"],
                        "reviewerId": "gtm",
                        "iteration": iteration,
                        "feedback": feedback,
                        "issues": issues,
                        "changeChecks": verified_checks,
                    })

            outputs.append({
                "id": agent_id,
                "agent": profile["name"],
                "content": final_content,
                "reviewStatus": "approved" if accepted else "needs_review",
                "reviewIterations": stage_reviews,
            })
            if not accepted:
                emit_event({
                    "type": "workflow_paused",
                    "agentId": "gtm",
                    "targetAgentId": agent_id,
                    "targetName": profile["name"],
                    "iteration": len(stage_reviews),
                    "message": f"The Go-To-Market Lead still needs changes after {MAX_REVISIONS} automatic corrections. Human review is required before later stages proceed.",
                })
                break

        status_value = "approved" if outputs and outputs[-1]["reviewStatus"] == "approved" and len(outputs) == len(specialists) else "needs_review"
        emit({"outputs": outputs, "reviewHistory": review_history, "status": status_value, "model": model})
        return 0
    except Exception as error:
        emit({"error": f"CrewAI could not complete the run: {str(error)[:700]}"})
        return 1


def main() -> int:
    if "--status" in sys.argv:
        return status()
    try:
        brief = json.load(sys.stdin)
        if not isinstance(brief, dict):
            raise ValueError("The brief must be a JSON object.")
        return run(brief)
    except Exception as error:
        emit({"error": str(error)[:700]})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
