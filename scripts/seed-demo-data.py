"""Seed the demo corpus: 5 CC-licensed-style tutorial videos with segments,
natural breaks, and ad slots, into SQLite.

Idempotent (INSERT OR REPLACE) — safe to re-run after `npx drizzle-kit push`.
"""

import sqlite3

MUX_TEST_HLS = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"

VIDEOS = [
    {
        "id": "vid_demo001",
        "title": "Getting Started with CSS Grid",
        "filename": "css-grid-tutorial.mp4",
        "duration_ms": 600000,
        "poster": "https://images.unsplash.com/photo-1587620962725-abab7fe55159?w=800",
        "segments": [
            ("seg_001", 0, 0, 120000, "Welcome to this CSS Grid tutorial. In this video, we will cover grid layout fundamentals, rows, columns, and auto-placement.", "Introduction"),
            ("seg_002", 1, 120000, 240000, "So to center a div using CSS Grid, you set display: grid on the parent and place-items: center on the container. This is the cleanest way to center anything.", "Centering with Grid"),
            ("seg_003", 2, 240000, 360000, "Grid template columns lets you define the column structure. You can use repeat, auto-fill, and minmax for responsive layouts without media queries.", "Columns & Responsive"),
            ("seg_004", 3, 360000, 480000, "Grid areas allow you to name specific sections of your layout and arrange them intuitively using grid-template-areas.", "Named Grid Areas"),
            ("seg_005", 4, 480000, 600000, "Summary and best practices for production-ready CSS layouts. Use grid for two-dimensional layout and flexbox for one-dimensional flow. Thanks for watching!", "Summary"),
        ],
    },
    {
        "id": "vid_demo002",
        "title": "Python Data Structures Explained",
        "filename": "python-data-structures.mp4",
        "duration_ms": 540000,
        "poster": "https://images.unsplash.com/photo-1526379095098-d400fd0bf935?w=800",
        "segments": [
            ("seg_101", 0, 0, 135000, "Let's talk about Python's four built-in data structures: lists, tuples, sets, and dictionaries. Choosing the right one makes your code faster and clearer.", "Overview"),
            ("seg_102", 1, 135000, 270000, "Lists are ordered and mutable. Use append to add items and a list comprehension to transform them. Tuples are the immutable cousin — perfect for fixed records.", "Lists & Tuples"),
            ("seg_103", 2, 270000, 405000, "Dictionaries map keys to values with O(1) lookup. Since Python 3.7 they preserve insertion order. Sets give you deduplication and fast membership tests.", "Dicts & Sets"),
            ("seg_104", 3, 405000, 540000, "Rule of thumb: list for sequences, dict for lookup tables, set for uniqueness checks, tuple for anything that must not change. That covers the essentials.", "When to Use Which"),
        ],
    },
    {
        "id": "vid_demo003",
        "title": "React Hooks Crash Course",
        "filename": "react-hooks-course.mp4",
        "duration_ms": 570000,
        "poster": "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800",
        "segments": [
            ("seg_201", 0, 0, 142000, "React hooks let function components hold state and run side effects. We'll cover useState, useEffect, useRef, and when to reach for useMemo and useCallback.", "Intro to Hooks"),
            ("seg_202", 1, 142000, 285000, "useState gives a component local state. Each call returns the current value and a setter. Never mutate state directly — always call the setter with a new value.", "useState"),
            ("seg_203", 2, 285000, 428000, "useEffect runs after render. The dependency array controls re-runs: empty array means once on mount. Return a cleanup function for timers and subscriptions.", "useEffect"),
            ("seg_204", 3, 428000, 570000, "useRef holds a mutable value that survives renders without causing them — ideal for DOM nodes and previous values. useMemo caches expensive computations.", "useRef & useMemo"),
        ],
    },
    {
        "id": "vid_demo004",
        "title": "Docker for Beginners: Containers in 10 Minutes",
        "filename": "docker-beginners.mp4",
        "duration_ms": 600000,
        "poster": "https://images.unsplash.com/photo-1605745341112-85968b19335b?w=800",
        "segments": [
            ("seg_301", 0, 0, 150000, "Docker packages your app and its dependencies into a container image that runs the same everywhere. Let's go from zero to a running container.", "Why Docker"),
            ("seg_302", 1, 150000, 300000, "A Dockerfile is a recipe: FROM a base image, COPY your code, RUN the install steps, and CMD to start the app. Build it with docker build -t myapp .", "Writing a Dockerfile"),
            ("seg_303", 2, 300000, 450000, "Images are read-only layers; containers are running instances. Use docker run -p 3000:3000 to map ports and docker ps to see what's running.", "Images vs Containers"),
            ("seg_304", 3, 450000, 600000, "Volumes persist data beyond a container's life, and multi-stage builds keep production images small. That's your foundational Docker toolkit.", "Volumes & Best Practices"),
        ],
    },
    {
        "id": "vid_demo005",
        "title": "SQL Joins Visualized",
        "filename": "sql-joins-visualized.mp4",
        "duration_ms": 480000,
        "poster": "https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=800",
        "segments": [
            ("seg_401", 0, 0, 120000, "Joins combine rows from two tables based on a related column. We'll visualize INNER, LEFT, RIGHT, and FULL OUTER joins with practical examples.", "Join Basics"),
            ("seg_402", 1, 120000, 240000, "INNER JOIN returns only matching rows — orders with a valid customer. LEFT JOIN keeps every row from the left table, filling NULLs where there's no match.", "Inner & Left Joins"),
            ("seg_403", 2, 240000, 360000, "RIGHT JOIN mirrors LEFT. FULL OUTER keeps everything from both sides. Self joins compare rows within one table — think employees and their managers.", "Right, Full & Self Joins"),
            ("seg_404", 3, 360000, 480000, "Watch out for fan-out: joining one-to-many tables multiplies rows and can break your aggregates. Count distinct or pre-aggregate to stay correct.", "Common Pitfalls"),
        ],
    },
]

BREAKS = {
    "vid_demo001": [("brk_001", 120000, 85), ("brk_002", 240000, 92), ("brk_003", 360000, 78), ("brk_004", 480000, 90)],
    "vid_demo002": [("brk_101", 135000, 88), ("brk_102", 270000, 84), ("brk_103", 405000, 91)],
    "vid_demo003": [("brk_201", 142000, 86), ("brk_202", 285000, 90), ("brk_203", 428000, 82)],
    "vid_demo004": [("brk_301", 150000, 89), ("brk_302", 300000, 85), ("brk_303", 450000, 93)],
    "vid_demo005": [("brk_401", 120000, 87), ("brk_402", 240000, 90), ("brk_403", 360000, 83)],
}

# Layer 3 in-scene slots + one Layer 2 natural-break slot (demo brands from
# seed-brands.py — run it first).
SLOTS = [
    ("slot_001", "vid_demo001", "seg_002", 3, 180000, "filled", "mug", "brd_demo003",
     "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800",
     "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800"),
    ("slot_002", "vid_demo001", "seg_003", 3, 300000, "filled", "laptop_lid", "brd_demo004",
     "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800",
     "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800"),
    ("slot_101", "vid_demo002", "seg_102", 3, 200000, "filled", "bottle", "brd_demo001",
     "https://images.unsplash.com/photo-1523362628745-0c100150b504?w=800",
     "https://images.unsplash.com/photo-1523362628745-0c100150b504?w=800"),
    ("slot_301", "vid_demo004", "seg_303", 3, 330000, "filled", "can", "brd_demo002",
     "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=800",
     "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=800"),
]


def seed():
    conn = sqlite3.connect("brandframe.db")
    cursor = conn.cursor()

    cursor.execute("""
        INSERT OR REPLACE INTO users (id, name, email)
        VALUES ('usr_demo', 'Demo Creator', 'creator@brandframe.ai')
    """)

    for video in VIDEOS:
        cursor.execute("""
            INSERT OR REPLACE INTO videos
                (id, title, filename, content_type, size_bytes, duration_ms,
                 status, b2_key, hls_url, poster_url, user_id)
            VALUES (?, ?, ?, 'video/mp4', ?, ?, 'ready', ?, ?, ?, 'usr_demo')
        """, (
            video["id"], video["title"], video["filename"], 45_000_000,
            video["duration_ms"], f"uploads/{video['id']}/source.mp4",
            MUX_TEST_HLS, video["poster"],
        ))

        for seg_id, idx, start_ms, end_ms, transcript, topic in video["segments"]:
            cursor.execute("""
                INSERT OR REPLACE INTO segments
                    (id, video_id, "index", start_ms, end_ms, transcript, topic)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (seg_id, video["id"], idx, start_ms, end_ms, transcript, topic))

        for brk_id, ts_ms, score in BREAKS[video["id"]]:
            cursor.execute("""
                INSERT OR REPLACE INTO natural_breaks (id, video_id, timestamp_ms, score)
                VALUES (?, ?, ?, ?)
            """, (brk_id, video["id"], ts_ms, score))

    for slot in SLOTS:
        cursor.execute("""
            INSERT OR REPLACE INTO ad_slots
                (id, video_id, segment_id, layer, timestamp_ms, status,
                 surface_label, brand_id, before_frame_url, after_frame_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, slot)

    conn.commit()
    conn.close()
    print(f"Seeded {len(VIDEOS)} videos, "
          f"{sum(len(v['segments']) for v in VIDEOS)} segments, "
          f"{sum(len(b) for b in BREAKS.values())} natural breaks, "
          f"{len(SLOTS)} ad slots.")


if __name__ == "__main__":
    seed()
