"""Seed demo brands into the database."""

import sqlite3
import json

BRANDS = [
    {
        "id": "brd_demo001",
        "name": "DemoCola",
        "category": "beverage",
        "logoUrl": None,
        "packshotUrl": None,
        "colorHex": "#e63946",
        "allowedSurfaces": ["can", "bottle"],
    },
    {
        "id": "brd_demo002",
        "name": "TechBook",
        "category": "publishing",
        "logoUrl": None,
        "packshotUrl": None,
        "colorHex": "#457b9d",
        "allowedSurfaces": ["book_cover"],
    },
    {
        "id": "brd_demo003",
        "name": "BrewMate",
        "category": "kitchenware",
        "logoUrl": None,
        "packshotUrl": None,
        "colorHex": "#2a9d8f",
        "allowedSurfaces": ["mug"],
    },
    {
        "id": "brd_demo004",
        "name": "LaptopPro",
        "category": "electronics",
        "logoUrl": None,
        "packshotUrl": None,
        "colorHex": "#8d6e63",
        "allowedSurfaces": ["laptop_lid", "screen"],
    },
    {
        "id": "brd_demo005",
        "name": "SnackBox",
        "category": "food",
        "logoUrl": None,
        "packshotUrl": None,
        "colorHex": "#e76f51",
        "allowedSurfaces": ["cereal_box"],
    },
]


def seed():
    conn = sqlite3.connect("brandframe.db")
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS brands (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            logo_url TEXT,
            packshot_url TEXT,
            color_hex TEXT NOT NULL DEFAULT '#f15a22',
            allowed_surfaces TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)

    for brand in BRANDS:
        cursor.execute(
            """INSERT OR REPLACE INTO brands (id, name, category, logo_url, packshot_url, color_hex, allowed_surfaces)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                brand["id"],
                brand["name"],
                brand["category"],
                brand["logoUrl"],
                brand["packshotUrl"],
                brand["colorHex"],
                json.dumps(brand["allowedSurfaces"]),
            ),
        )

    conn.commit()
    conn.close()
    print(f"Seeded {len(BRANDS)} brands.")


if __name__ == "__main__":
    seed()
