import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q: query = "" } = await searchParams;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <form className="flex gap-2">
          <Input
            name="q"
            placeholder="Search videos... e.g., 'how do I center a div'"
            defaultValue={query}
            className="flex-1"
          />
          <Button type="submit"><SearchIcon className="h-4 w-4" /></Button>
        </form>
      </div>

      {query && (
        <div className="mb-4">
          <h2 className="text-sm text-muted-foreground">Results for &quot;{query}&quot;</h2>
        </div>
      )}

      <div className="space-y-4">
        <Card className="bg-card">
          <CardContent className="flex gap-4 p-4">
            <div className="h-24 w-40 flex-shrink-0 rounded-md bg-muted" />
            <div className="flex-1">
              <h3 className="font-semibold">Getting Started with CSS Grid</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                A comprehensive tutorial on CSS Grid layout...
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>12:34</span>
                <span>•</span>
                <span>Watch</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
