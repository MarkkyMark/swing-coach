# Swing Coach — AI Golf Swing Analysis

> **CS 153 Final Project · Application / Product Track**  
> Mark Krupkin · Stanford University · Spring 2026

A full-stack web application that analyzes your golf swing by comparing it frame-by-frame against professional reference swings. Users upload their own swing video, manually assign frames to each of 8 canonical swing phases, and receive biomechanical angle comparisons, per-phase scores, and AI-generated coaching feedback — all without expensive in-person instruction.

---

## Why I Built This

Golf instruction from a PGA-certified professional costs $100–$300 per hour and is largely inaccessible to recreational players. Existing video analysis tools are either proprietary ($500+ software) or produce unreliable automatic phase detection that misidentifies key positions.

The bottleneck I identified: **accurate phase alignment is the whole problem.** Automatic detection consistently fails at impact and the top of the backswing — exactly the frames that matter most. My approach flips this: let the user manually select the frame for each phase (a one-time 60-second step), then use those precise selections to drive all downstream analysis.

I combined:
- **GolfDB** (a research dataset of pre-labeled professional swing videos) as the reference library
- **MediaPipe** pose estimation to extract joint angles from each selected frame
- **Circular angle math** to avoid phantom 180° errors in shoulder/hip rotation comparisons
- **Claude** to convert biomechanical deviation data into natural-language coaching tips
- A phase-aligned skeleton overlay so users can visually compare their body positions to a pro's

---

## How It Works

### User Flow

```
1. Upload your swing video
2. Select metadata (handedness, camera angle, club)
3. Pick a reference pro swing from the library
4. Manually assign one frame per phase (8 total) in both videos
5. Generate comparison → receive scores, angle deviations, AI feedback
6. View skeleton overlay to visually compare posture
```

### Technical Pipeline

```
User Video (MP4/MOV)
    │
    ├─ Frame Extraction (OpenCV)
    │     Automatic H.264 transcoding + moov-atom faststart fix
    │     Orientation correction via ffprobe metadata
    │
    ├─ Manual Phase Selection (browser video player)
    │     8 phases: Address → Takeaway → Backswing → Top →
    │               Downswing → Impact → Follow Through → Finish
    │     Frame stepping with 0.5× default playback + zoom for impact
    │
    ├─ Pose Detection (MediaPipe, per selected frame only — 16 frames total)
    │     17 joints detected per frame
    │     Angle computation: spine lean, hip/shoulder rotation, elbow angles
    │     Circular angle normalization (mod 180°) for line-angle metrics
    │
    ├─ Phase-Aligned Comparison
    │     Each phase compared independently against the same phase in the reference
    │     Deviation = circular_delta(user_angle, ref_angle) for line angles
    │     Scoring: baseline 10.0 − (RMS_deviation × 0.15), clamped [1, 10]
    │     Weighted overall: Impact 40%, Downswing 25%, Top 20%, others 15%
    │
    └─ AI Coaching (Claude claude-opus-4-8)
          Structured biomechanical report sent as JSON
          Returns: summary, strengths, improvements, per-phase drills
          Graceful stub fallback if API key not set
```

### Architecture

```
backend/
├── main.py                      FastAPI app, startup checks, static serving
├── pipeline.py                  Legacy automated pipeline (still functional)
├── api/
│   ├── session_manager.py       Thread-safe session state
│   └── routes/
│       ├── upload.py            POST /api/upload (video + metadata)
│       ├── frame_selection.py   Manual phase frame selection + comparison
│       ├── library.py           Reference library CRUD
│       └── frames.py            Frame serving endpoints
├── services/
│   ├── frame_comparison.py      Core comparison engine (16-frame analysis)
│   ├── frame_extraction.py      OpenCV frame extractor + rotation fix
│   ├── pose_detection.py        MediaPipe → keypoint dicts
│   ├── angle_calculator.py      Angle computation + circular normalization
│   ├── feedback_service.py      Claude API integration
│   ├── library_service.py       File-based reference library
│   └── video_converter.py       H.264 transcoding via imageio-ffmpeg
├── auth/
│   ├── db.py                    SQLite user store
│   ├── routes.py                JWT signup/login/me
│   └── utils.py                 bcrypt hashing (direct, no passlib)
├── models/
│   ├── schemas.py               Core Pydantic models
│   └── library_schemas.py       Library + comparison result models
├── data/
│   └── library/                 64 pre-loaded GolfDB reference swings (videos + library.json)
└── scripts/
    └── import_golfdb.py         Bulk import script (used to build the library)

frontend/src/
├── pages/
│   ├── UploadPage.jsx           Video upload + metadata selection
│   ├── FrameSelectionPage.jsx   Dual video player with phase assignment
│   ├── ComparisonPage.jsx       Results: scores, metrics, AI feedback
│   ├── OverlayComparisonPage.jsx Skeleton overlay (static + animated)
│   ├── LibraryPage.jsx          Reference library management
│   └── MySwingsPage.jsx         Saved sessions for logged-in users
└── components/
    ├── VideoFramePlayer.jsx     Frame-accurate video player (0.5× default, zoom)
    ├── ComparisonPhaseView.jsx  Side-by-side comparison with deviation bars
    ├── LibraryBrowser.jsx       Library grid with source/filter support
    └── SkeletonOverlay.jsx      Canvas-based skeleton renderer
```

---

## Key Technical Decisions

**Why manual phase selection instead of automatic detection?**  
Every automatic phase detection system I built (shoulder rotation heuristic, DTW alignment against synthetic references, wrist trajectory tracking) consistently misidentified the impact frame — the most biomechanically important moment. The error was 200–400ms, which corresponds to 30+ frames at 30fps. This is not a solvable problem without labeled training data on the specific camera angle and player. Manual selection takes ~60 seconds and is exact.

**Why circular angle math for shoulder/hip rotation?**  
`atan2(dy, dx)` returns values in (−180°, 180°]. A shoulder line has 180° symmetry — the angle from A→B differs from B→A by 180° but represents the same physical orientation. Linear subtraction produced phantom +176° errors (shoulders visually identical, numerically opposite). Fix: normalize to [0°, 180°) before computing delta, giving the geometrically correct result.

**Why real-time videos instead of slow-motion for the reference library?**  
Slow-motion footage (240fps) makes frame selection easier but destroys tempo information and creates inconsistency when mixing different slow-mo levels across library entries. The app compensates by defaulting video playback to 0.5× and providing impact-zone zoom (2.5×), giving the precision of slow-motion without the data integrity tradeoff.

**Why imageio-ffmpeg instead of system ffmpeg?**  
Videos uploaded by users (especially from iPhones) use MPEG-4 Part 2 (mp4v) or H.265 — neither plays in Chrome's HTML5 video element. `imageio-ffmpeg` ships a self-contained ffmpeg binary via pip, ensuring transcoding works without requiring users to install system packages.

---

## Features

| Feature | Description |
|---|---|
| Manual phase selection | 8-phase frame picker with 0.5× playback, frame stepping (← →), 2.5× impact zoom |
| Phase-aligned comparison | Each phase compared only to the same phase in the reference (not time-based) |
| Reference library | 64 professional swings from GolfDB with pre-labeled phase frames |
| Skeleton overlay | White (user) + green (reference) normalized skeleton on shared canvas |
| Animated sync | Progress-based interpolation between phase key frames at configurable speed |
| Weighted scoring | Impact 40%, Downswing 25%, Top 20%, remaining phases 15% |
| AI coaching | Claude-generated per-phase tips, drills, and overall swing summary |
| User accounts | JWT auth, My Swings history, Save to account from comparison page |
| Video compatibility | Auto-transcodes any upload to H.264/AAC/yuv420p with faststart |

---

## Setup & Reproduction

### Prerequisites

- Python 3.11+
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/) (optional — stub feedback works without it)

### Backend

```bash
cd backend

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt  # includes imageio-ffmpeg, mediapipe, opencv, etc.

cp .env.example .env
# Edit .env:
#   ANTHROPIC_API_KEY=sk-ant-...   (optional)
#   JWT_SECRET_KEY=change-me-in-production

uvicorn main:app --reload --port 8000
```

Backend: http://localhost:8000  
API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173

### Environment Variables

```env
ANTHROPIC_API_KEY=sk-ant-...         # Claude API — omit for stub feedback
JWT_SECRET_KEY=your-secret-here      # JWT signing key
MAX_VIDEO_DURATION_SECONDS=90
STORAGE_DIR=./storage
CORS_ORIGINS=http://localhost:5173
```

---

## Evaluation & Evidence

### Angle Comparison Accuracy

Before implementing circular angle normalization, shoulder rotation deltas of +176° were common between visually identical postures. The fix (mod-180° normalization for line angles) reduced these to the correct ~3° delta. This is validated analytically: for angles `a=57.4°` and `b=-119.0°`, `normalize(57.4)=57.4°` and `normalize(-119.0)=61.0°`, giving `|delta|=3.6°` — matching visual inspection.

### GolfDB Phase Labels as Ground Truth

The reference library uses frame indices from GolfDB's expert-labeled swing events as pre-assigned phase points. These labels were produced by sports science researchers and validated in peer review. This means the reference side of every comparison uses human-expert-validated phase assignments.

### Scoring Calibration

Phase scoring formula: `score = max(1, min(10, 10 − RMS_deviation × 0.15))`. This means:
- RMS deviation of 0° → score 10 (perfect match)  
- RMS deviation of 20° → score 7 (good)  
- RMS deviation of 45° → score 3.25 (significant deviation)

The 0.15 penalty coefficient was chosen so that typical address posture deviations (~15–20°) produce mid-range scores (6–8), which matches what a human coach would consider "needs work but not terrible."

### Limitations

- **No automated validation of pose detection accuracy** — MediaPipe's output is used without a ground-truth comparison. Low-confidence detections (visibility < 0.2) are filtered, but detection can still fail on dark footage or unusual camera angles.
- **Phase selection is user-dependent** — Two users selecting the same phase from the same video may choose frames 2–3 seconds apart, producing different angle measurements. This is the main source of result variance.
- **Reference library is camera-angle and club-filtered** — Comparing a DTL user swing against a face-on reference produces misleading angle deltas. The app enforces same-angle same-club filtering in the comparison UI.
- **No user studies conducted** — Evaluation is based on analytical correctness of the math and qualitative inspection of results, not structured user testing.

---

## Data Sources & Citations

### GolfDB Dataset

The professional reference swing library uses videos and phase labels from:

> McNally, W., Vats, K., Pinto, T., Dulhanty, C., McPhee, J., & Wong, A. (2019).  
> **GolfDB: A Video Database for Golf Swing Sequencing.**  
> *Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR) Workshops.*

GitHub: https://github.com/wmcnally/golfdb

The CSV event labels map directly to the 8 canonical swing phases used in this app. Videos are used under the dataset's research license for non-commercial academic use.

### MediaPipe

Pose estimation uses Google's MediaPipe Pose solution:
> Lugaresi, C., Tang, J., Nash, H., et al. (2019). *MediaPipe: A Framework for Building Perception Pipelines.* arXiv:1906.08172.

### Anthropic Claude

AI coaching feedback is generated via the Claude API (claude-opus-4-8). Prompts are structured to produce JSON-schema-compliant responses that are parsed and displayed per-phase.

---

## AI Usage Disclosure

**This project was built using [Claude Code](https://claude.ai/code) (Anthropic) as the primary development tool.**

Claude Code was used throughout the entire development process, including:

- **Architecture design** — Initial project structure, API design, data model design
- **Code generation** — All backend (FastAPI, services, models) and frontend (React components, pages, hooks) code was generated through iterative conversation with Claude Code
- **Bug diagnosis and fixing** — Every bug described in this README's "Key Technical Decisions" section was diagnosed with Claude's assistance (bcrypt/passlib incompatibility, circular angle math, video codec issues, session persistence bugs)
- **Algorithm design** — The circular angle normalization fix, weighted scoring system, and phase-aware animation sync logic were designed in collaboration with Claude
- **Documentation** — This README was written with Claude's assistance

The engineering judgment — what to build, what tradeoffs to make, what bugs are real vs. phantom, when an approach is wrong — was the author's. Claude acted as a coding partner that executed those decisions.

All AI-generated code was reviewed, tested against real videos, and iterated upon based on observed behavior. No code was shipped without the author understanding what it does and verifying it against the actual running system.

---

## What I Would Add With More Time

- **Structured user study** — A/B test the manual frame selection approach vs. automatic detection, measuring comparison accuracy and user satisfaction
- **Swing tempo metrics** — The reference videos contain frame-level timing data. Comparing how fast each phase transition happens (not just joint angles) would add a meaningful new dimension
- **Mobile app** — The current app requires desktop for comfortable frame selection. A native mobile app with Apple Vision Pro integration could enable on-course real-time feedback
- **Expanded club/angle library** — Currently 64 reference swings. More entries per player × angle × club would improve the filtering usefulness
- **Multi-frame averaging** — Instead of one selected frame per phase, average keypoints across a ±3 frame window to reduce sensitivity to the exact frame chosen

---

## Project Track

**Application / Product** — A fully functional web application targeting recreational golfers who want accessible, data-driven swing analysis.
