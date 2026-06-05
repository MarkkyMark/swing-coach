"""
AI feedback generation via Anthropic Claude.
Mirrors Swift FeedbackGenerationService.

Sends a compact structured JSON report (angles + scores + deviations)
and expects a structured JSON response with per-phase feedback + overall summary.
Falls back to stub feedback if the API key is missing or the call fails.
"""
from __future__ import annotations
import json
import os
from typing import Any, Dict, List, Optional

import anthropic

from models.schemas import PhaseFeedback, SwingAnalysis, SwingPhase

SYSTEM_PROMPT = """You are an elite PGA-certified biomechanics coach analyzing a golf swing.

You will receive a JSON object containing per-phase biomechanical scores, joint angles, \
and deviation from a professional reference swing.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "summary": "2-3 sentence executive summary",
  "top_strengths": ["strength 1", "strength 2", "strength 3"],
  "top_improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "recommended_drills": ["drill with reps/sets", "drill 2", "drill 3"],
  "phase_feedback": [
    {
      "phase": "Address",
      "summary": "one concise sentence",
      "strengths": ["specific strength"],
      "improvements": ["specific improvement with degrees if available"],
      "drills": ["concrete drill with reps"]
    }
  ]
}

Rules:
- Be specific — cite exact angle deviations when the data includes them.
- Prioritize the highest-deviation phases in top_improvements.
- Each drill must be actionable (e.g., "10 slow-motion address holds focusing on spine angle").
- phase_feedback must include one entry for each of the 8 swing phases.
- Do not repeat the same advice across multiple phases.
- Output only raw JSON — no markdown fences, no extra text."""


def generate_feedback(analysis: SwingAnalysis, pro_name: str) -> SwingAnalysis:
    """
    Build a biomechanical report, send to Claude, parse the response,
    and return an updated SwingAnalysis with feedback populated.
    """
    report = _build_report(analysis, pro_name)

    try:
        raw = _call_claude(json.dumps(report, indent=2))
        parsed = _parse_response(raw)
    except Exception as e:
        print(f"[FeedbackService] Claude call failed ({e}), using stub feedback.")
        parsed = _stub_feedback(analysis)

    return _apply_feedback(analysis, parsed)


# ---------------------------------------------------------------------------
# Report construction
# ---------------------------------------------------------------------------

def _build_report(analysis: SwingAnalysis, pro_name: str) -> Dict:
    phases = []
    for phase in analysis.phases:
        avg = phase.avg_angles
        phases.append({
            "phase":             phase.name,
            "score":             phase.score.overall if phase.score else 0,
            "spine_angle":       avg.spine_angle,
            "hip_rotation":      avg.hip_rotation,
            "shoulder_rotation": avg.shoulder_rotation,
            "left_elbow_angle":  avg.left_elbow_angle,
            "avg_deviation_rms": phase.avg_deviation_rms,
        })

    return {
        "pro_reference": pro_name,
        "overall_score": analysis.overall_score,
        "phases":        phases,
    }


# ---------------------------------------------------------------------------
# Claude API call
# ---------------------------------------------------------------------------

def _call_claude(user_message: str) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    return message.content[0].text


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _parse_response(text: str) -> Dict:
    # Strip markdown fences if present
    if "```" in text:
        start = text.find("{")
        end   = text.rfind("}") + 1
        text  = text[start:end]
    return json.loads(text)


def _apply_feedback(analysis: SwingAnalysis, parsed: Dict) -> SwingAnalysis:
    # Map phase name → feedback DTO
    phase_map: Dict[str, Dict] = {
        pf["phase"]: pf for pf in parsed.get("phase_feedback", [])
    }

    new_phases = []
    for phase in analysis.phases:
        dto = phase_map.get(phase.name, {})
        fb  = PhaseFeedback(
            summary=     dto.get("summary", ""),
            strengths=   dto.get("strengths", []),
            improvements=dto.get("improvements", []),
            drills=      dto.get("drills", []),
        )
        new_phases.append(phase.model_copy(update={"feedback": fb}))

    return analysis.model_copy(update={
        "phases":            new_phases,
        "summary":           parsed.get("summary", ""),
        "top_strengths":     parsed.get("top_strengths", []),
        "top_improvements":  parsed.get("top_improvements", []),
        "recommended_drills": parsed.get("recommended_drills", []),
    })


# ---------------------------------------------------------------------------
# Stub fallback
# ---------------------------------------------------------------------------

def _stub_feedback(analysis: SwingAnalysis) -> Dict:
    """Returns a minimal valid response structure when the API is unavailable."""
    phase_feedback = []
    for phase in analysis.phases:
        score = phase.score.overall if phase.score else 5.0
        rms   = phase.avg_deviation_rms or 0

        improvements = []
        if rms > 10:
            improvements.append(
                f"Significant deviation from reference ({rms:.1f}° avg). Focus on this phase."
            )
        elif rms > 5:
            improvements.append(
                f"Moderate deviation from reference ({rms:.1f}° avg). Minor adjustments needed."
            )

        phase_feedback.append({
            "phase":        phase.name,
            "summary":      f"{phase.name} scored {score:.1f}/10.",
            "strengths":    ["Movement detected and measured successfully."] if score > 6 else [],
            "improvements": improvements or ["Review your {phase.name} position with a coach."],
            "drills":       [f"Practice slow-motion {phase.name.lower()} with video feedback."],
        })

    overall = analysis.overall_score
    return {
        "summary": (
            f"Your swing scored {overall:.1f}/10 overall. "
            "Analysis complete — connect your Anthropic API key for personalized coaching tips."
        ),
        "top_strengths":     ["Swing motion detected across all phases."],
        "top_improvements":  ["Set ANTHROPIC_API_KEY for AI-generated coaching feedback."],
        "recommended_drills": ["Record and review your swing in slow motion."],
        "phase_feedback":    phase_feedback,
    }
