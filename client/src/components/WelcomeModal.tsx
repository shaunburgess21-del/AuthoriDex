import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TrendingUp, CheckSquare, LineChart } from "lucide-react";
import heroImage from "@assets/generated_images/Hero_background_network_visualization_1293b14e.png";

const STORAGE_KEY = "voxdex_seen_intro";

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const timer = setTimeout(() => setOpen(true), 500);
    return () => clearTimeout(timer);
  }, []);

  function close() {
    setOpen(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }

  function handleCTA(action: "leaderboard" | "vote" | "predict") {
    close();
    if (action === "leaderboard") {
      document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth" });
    } else if (action === "vote") {
      navigate("/vote");
    } else {
      navigate("/predict");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-[600px] p-0 overflow-hidden border-border/50 bg-transparent gap-0">
        <div className="relative min-h-[340px] w-full overflow-hidden rounded-lg">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${heroImage})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background" />
          <div className="relative flex flex-col items-center justify-center px-6 py-10 text-center">
            <h2 className="text-4xl md:text-5xl font-serif font-bold mb-4 tracking-tight">
              <span>Vox Populi</span>{" "}
              <span className="text-primary">Index</span>
            </h2>
            <p className="text-base md:text-lg text-muted-foreground mb-8 max-w-md">
              Discover real-time insights, cast your vote and make your prediction on the world's most influential people
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => handleCTA("leaderboard")}
                className="group relative inline-flex items-center justify-center gap-2 rounded-md px-6 min-h-10 text-sm font-semibold border border-[#4C5567] text-white transition-all duration-300 overflow-hidden"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <TrendingUp className="h-5 w-5 relative z-10" />
                <span className="relative z-10">Explore Leaderboard</span>
              </button>
              <button
                onClick={() => handleCTA("vote")}
                className="group relative inline-flex items-center justify-center gap-2 rounded-md px-6 min-h-10 text-sm font-semibold border border-[#4C5567] text-white transition-all duration-300 overflow-hidden"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <CheckSquare className="h-5 w-5 relative z-10" />
                <span className="relative z-10">Cast Your Vote</span>
              </button>
              <button
                onClick={() => handleCTA("predict")}
                className="group relative inline-flex items-center justify-center gap-2 rounded-md px-6 min-h-10 text-sm font-semibold border border-[#4C5567] text-white transition-all duration-300 overflow-hidden"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <LineChart className="h-5 w-5 relative z-10" />
                <span className="relative z-10">Prediction Markets</span>
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
