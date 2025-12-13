
interface ProfileTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "vote", label: "Vote" },
  { id: "predict", label: "Predict" },
];

export function ProfileTabs({ activeTab, onTabChange }: ProfileTabsProps) {
  return (
    <div className="flex items-center justify-center mb-8" data-testid="profile-tabs">
      {/* Dark muted track container */}
      <div className="w-full max-w-md grid grid-cols-3 gap-2 p-1.5 bg-gray-900/50 dark:bg-gray-900/60 rounded-2xl border border-gray-800/50 dark:border-gray-700/30">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                ${isActive
                  ? "border border-blue-500 bg-blue-500/10 text-blue-400 font-semibold shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                  : "border border-transparent bg-transparent text-gray-500 hover:text-gray-300"
                }
              `}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
