"""Seed demo video, segments, natural breaks, and ad slots into SQLite."""

import sqlite3
import json

def seed():
    conn = sqlite3.connect("brandframe.db")
    cursor = conn.cursor()

    # Insert user
    cursor.execute("""
        INSERT OR REPLACE INTO users (id, name, email)
        VALUES ('usr_demo', 'Demo Creator', 'creator@brandframe.ai')
    """)

    # Insert video
    cursor.execute("""
        INSERT OR REPLACE INTO videos (id, title, filename, content_type, size_bytes, duration_ms, status, b2_key, hls_url, poster_url, user_id)
        VALUES (
            'vid_demo001',
            'Getting Started with CSS Grid',
            'css-grid-tutorial.mp4',
            'video/mp4',
            45000000,
            600000,
            'ready',
            'uploads/vid_demo001/source.mp4',
            'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
            'https://images.unsplash.com/photo-1587620962725-abab7fe55159?w=800',
            'usr_demo'
        )
    """)

    # Insert segments
    segments = [
        ("seg_001", "vid_demo001", 0, 0, 120000, "Welcome to CSS Grid tutorial. In this video, we will cover grid layout fundamentals, rows, columns, and auto-placement.", "Introduction"),
        ("seg_002", "vid_demo001", 1, 120000, 240000, "So to center a div using CSS Grid, you set display: grid on the parent and place-items: center on the container. This is the cleanest way.", "Centering with Grid"),
        ("seg_003", "vid_demo001", 2, 240000, 360000, "Grid template columns lets you define the column structure. You can use repeat, auto-fill, and minmax for responsive layouts without media queries.", "Grid Columns & Responsive"),
        ("seg_004", "vid_demo001", 3, 360000, 480000, "Grid areas allow you to name specific sections of your layout and arrange them intuitively using grid-template-areas.", "Named Grid Areas"),
        ("seg_005", "vid_demo001", 4, 480000, 600000, "Summary and best practices for production-ready CSS layouts. Thanks for watching!", "Summary"),
    ]

    for seg in segments:
        cursor.execute("""
            INSERT OR REPLACE INTO segments (id, video_id, "index", start_ms, end_ms, transcript, topic)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, seg)

    # Insert natural breaks
    breaks = [
        ("brk_001", "vid_demo001", 120000, 85),
        ("brk_002", "vid_demo001", 240000, 92),
        ("brk_003", "vid_demo001", 360000, 78),
        ("brk_004", "vid_demo001", 480000, 90),
    ]

    for brk in breaks:
        cursor.execute("""
            INSERT OR REPLACE INTO natural_breaks (id, video_id, timestamp_ms, score)
            VALUES (?, ?, ?, ?)
        """, brk)

    # Insert ad slots
    slots = [
        ("slot_001", "vid_demo001", "seg_002", 3, 180000, "filled", "mug", "brd_demo003", "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800", "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800"),
        ("slot_002", "vid_demo001", "seg_003", 2, 300000, "filled", "laptop_lid", "brd_demo004", "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800", "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800"),
    ]

    for slot in slots:
        cursor.execute("""
            INSERT OR REPLACE INTO ad_slots (id, video_id, segment_id, layer, timestamp_ms, status, surface_label, brand_id, before_frame_url, after_frame_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, slot)

    conn.commit()
    conn.close()
    print("Seeded demo video, segments, natural breaks, and ad slots successfully.")

if __name__ == "__main__":
    seed()
