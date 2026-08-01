"""Seed demo brands into the database.

Run after `npx drizzle-kit push` (brands table must exist with copy/target_url).
Idempotent: INSERT OR REPLACE.
"""

import sqlite3
import json

BRANDS = [
    {
        "id": "brd_demo001",
        "name": "DemoCola",
        "category": "beverage",
        "logoUrl": "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=200",
        "packshotUrl": "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=800",
        "copy": "Ice-cold refreshment for every coding session. Crack open a DemoCola.",
        "targetUrl": "https://example.com/democola",
        "colorHex": "#e63946",
        "allowedSurfaces": ["can", "bottle"],
    },
    {
        "id": "brd_demo002",
        "name": "TechBook",
        "category": "publishing",
        "logoUrl": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=200",
        "packshotUrl": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800",
        "copy": "Programming books that take you from tutorial hell to production.",
        "targetUrl": "https://example.com/techbook",
        "colorHex": "#457b9d",
        "allowedSurfaces": ["book_cover"],
    },
    {
        "id": "brd_demo003",
        "name": "BrewMate",
        "category": "kitchenware",
        "logoUrl": "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=200",
        "packshotUrl": "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800",
        "copy": "Coffee mugs and brewing gear for developers who ship before sunrise.",
        "targetUrl": "https://example.com/brewmate",
        "colorHex": "#2a9d8f",
        "allowedSurfaces": ["mug"],
    },
    {
        "id": "brd_demo004",
        "name": "LaptopPro",
        "category": "electronics",
        "logoUrl": "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=200",
        "packshotUrl": "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800",
        "copy": "Laptop skins and screen accessories for coders, designers, and streamers.",
        "targetUrl": "https://example.com/laptoppro",
        "colorHex": "#8d6e63",
        "allowedSurfaces": ["laptop_lid", "screen"],
    },
    {
        "id": "brd_demo005",
        "name": "SnackBox",
        "category": "food",
        "logoUrl": "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=200",
        "packshotUrl": "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=800",
        "copy": "Cereal and snack boxes that fuel marathon debugging sessions.",
        "targetUrl": "https://example.com/snackbox",
        "colorHex": "#e76f51",
        "allowedSurfaces": ["cereal_box"],
    },
]


def seed():
    conn = sqlite3.connect("brandframe.db")
    cursor = conn.cursor()

    for brand in BRANDS:
        cursor.execute(
            """INSERT OR REPLACE INTO brands
               (id, name, category, logo_url, packshot_url, copy, target_url, color_hex, allowed_surfaces)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                brand["id"],
                brand["name"],
                brand["category"],
                brand["logoUrl"],
                brand["packshotUrl"],
                brand["copy"],
                brand["targetUrl"],
                brand["colorHex"],
                json.dumps(brand["allowedSurfaces"]),
            ),
        )

    conn.commit()
    conn.close()
    print(f"Seeded {len(BRANDS)} brands.")


if __name__ == "__main__":
    seed()
