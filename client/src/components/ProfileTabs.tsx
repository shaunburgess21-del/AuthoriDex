import { useState, useEffect } from "react";
import { Eye, Vote, TrendingUp } from "lucide-react";

interface ProfileTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: "overview", label: "Overview", icon: Eye },
  { id: "vote", label: "Vote", icon: Vote },
  { id: "predict", label: "Predict", icon: TrendingUp },
];

export function ProfileTabs({ activeTab, onTabChange }: ProfileTabsProps) {
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setHasAnimated(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="mb-8" data-testid="profile-tabs">
      <div 
        className={`
          w-full grid grid-cols-3 gap-2 p-2 bg-muted/80 rounded-xl 
          border-2 border-primary/30
          ${!hasAnimated ? 'attention-pulse-once' : ''}
        `}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center justify-center gap-2
                px-4 py-3 rounded-lg text-base font-semibold transition-all duration-200
                ${isActive
                  ? "border-2 border-primary bg-primary/15 text-primary shadow-[0_0_20px_rgba(59,130,246,0.35)]"
                  : "border-2 border-transparent bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                }
              `}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : ''}`} />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
