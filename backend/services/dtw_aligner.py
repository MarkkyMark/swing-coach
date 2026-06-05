"""
Dynamic Time Warping (DTW) for swing phase alignment.

Why DTW instead of a fixed-time window:
  Golf swings vary dramatically in speed and timing.
  A fast transition player might spend 3 frames in downswing;
  a slow, deliberate player might spend 20 frames.
  DTW warps the time axis to find the optimal alignment regardless.

Sakoe-Chiba band constraint (band=0.4):
  Prevents degenerate alignments where the entire swing maps to a single
  reference frame. 40% of max(N, M) allows significant speed variation
  while maintaining a monotonic mapping.

Cost function:
  L2 distance between normalized pose feature vectors.
  Lower cost = better overall pose match.
"""
from __future__ import annotations
import logging
import numpy as np
from typing import List, Optional, Tuple

log = logging.getLogger(__name__)


def dtw_align(
    user_seq: np.ndarray,     # (N, D) user feature sequence
    ref_seq:  np.ndarray,     # (M, D) reference feature sequence
    band:     float = 0.40,   # Sakoe-Chiba constraint
) -> Tuple[List[Tuple[int, int]], float]:
    """
    DTW with Sakoe-Chiba band.

    Returns:
        path  — optimal warping as list of (user_idx, ref_idx) pairs
        cost  — total alignment cost normalized by N (lower = better match)
    """
    N, M = len(user_seq), len(ref_seq)
    w    = max(int(band * max(N, M)), abs(N - M) + 2)

    INF = np.inf
    D   = np.full((N, M), INF, dtype=np.float64)

    # Fill cost matrix using vectorised row operations where possible
    for i in range(N):
        j_lo = max(0, i - w)
        j_hi = min(M, i + w + 1)

        # Batch distance for this row slice
        row_dist = np.sqrt(np.sum((user_seq[i] - ref_seq[j_lo:j_hi]) ** 2, axis=1))

        for jj, j in enumerate(range(j_lo, j_hi)):
            d = float(row_dist[jj])
            if i == 0 and j == 0:
                D[i, j] = d
            elif i == 0:
                D[i, j] = d + D[0, j - 1] if j > 0 else d
            elif j == 0:
                D[i, j] = d + D[i - 1, 0]
            else:
                D[i, j] = d + min(D[i-1, j-1], D[i-1, j], D[i, j-1])

    total_cost = float(D[N-1, M-1])
    if total_cost == INF:
        log.warning("DTW: alignment unreachable (N=%d M=%d band=%d) — using linear path", N, M, w)
        path = _linear_path(N, M)
        return path, INF

    # Backtrack to find the optimal path
    path: List[Tuple[int, int]] = []
    i, j = N - 1, M - 1
    while i > 0 or j > 0:
        path.append((i, j))
        if i == 0:
            j -= 1
        elif j == 0:
            i -= 1
        else:
            move = np.argmin([D[i-1, j-1], D[i-1, j], D[i, j-1]])
            if move == 0:
                i -= 1; j -= 1
            elif move == 1:
                i -= 1
            else:
                j -= 1
    path.append((0, 0))
    path.reverse()

    normalized_cost = total_cost / N
    log.info("DTW: N=%d M=%d cost=%.4f (norm)", N, M, normalized_cost)
    return path, normalized_cost


def assign_phases(
    n_frames:   int,
    path:       List[Tuple[int, int]],
    ref_labels: List[str],
) -> List[str]:
    """
    Map each user frame to a reference frame via the DTW path,
    then read off the reference phase label.

    The DTW path may map many user frames to the same reference frame
    (many-to-one). We use the LAST reference assignment for each user index.
    """
    # Build user_idx → ref_idx mapping (last assignment wins)
    u2r: dict[int, int] = {}
    for ui, ri in path:
        u2r[ui] = ri

    labels: List[str] = []
    last_ri = 0
    for i in range(n_frames):
        ri       = u2r.get(i, last_ri)
        last_ri  = ri
        ri_clamped = min(ri, len(ref_labels) - 1)
        labels.append(ref_labels[ri_clamped])
    return labels


def _linear_path(N: int, M: int) -> List[Tuple[int, int]]:
    """Fallback: evenly space user frames across reference frames."""
    return [
        (i, min(int(i * M / N), M - 1))
        for i in range(N)
    ]
