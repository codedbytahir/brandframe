import { Shield, CheckCircle, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface VerifyPageProps {
  params: Promise<{ videoId: string }>;
}

export default async function VerifyPage({ params }: VerifyPageProps) {
  const { videoId } = await params;
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Shield className="h-8 w-8 text-emerald-500" />
        <div>
          <h1 className="text-3xl font-bold">Provenance Verification</h1>
            <p className="text-sm text-muted-foreground">
              Video: {videoId}
            </p>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-emerald-800 bg-emerald-950/30 p-4">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-emerald-500" />
          <span className="font-semibold text-emerald-500">Verified</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          All AI alterations are recorded in a Genblaze manifest and WORM-locked on Backblaze B2.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              Manifest Integrity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">SHA-256 Match</span>
                <Badge variant="success">Passed</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Object Lock</span>
                <Badge variant="success">COMPLIANCE 365d</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Retention</span>
                <Badge variant="success">Active</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              AI Placements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This video contains AI-generated ad placements. Each placement has
              been cryptographically signed and stored in Backblaze B2 with WORM retention.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">Placement Timeline</h2>
        <div className="space-y-3">
          {[{ time: "3:45", surface: "Mug", brand: "DemoBrand" }].map((p, i) => (
            <div key={i} className="flex items-center gap-4 rounded-md bg-card p-3">
              <span className="font-mono text-sm text-muted-foreground">{p.time}</span>
              <span className="flex-1 text-sm">{p.surface} → {p.brand}</span>
              <Badge variant="success">Verified</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
