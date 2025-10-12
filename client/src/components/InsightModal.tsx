import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface InsightItem {
  rank: number;
  title: string;
  metricValue: number;
  link?: string;
  imageUrl?: string;
  timestamp: Date;
}

interface InsightModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insightType: string;
  metricName: string;
  items: InsightItem[];
  platform: string;
}

function formatMetricValue(value: number, metricName: string): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function InsightModal({ 
  open, 
  onOpenChange, 
  insightType, 
  metricName, 
  items, 
  platform 
}: InsightModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="modal-insights">
        <DialogHeader>
          <DialogTitle className="text-2xl font-serif" data-testid="text-modal-title">
            {platform} - {insightType}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          {items.map((item) => (
            <div 
              key={item.rank}
              className="flex gap-4 p-4 rounded-lg border hover-elevate"
              data-testid={`insight-item-${item.rank}`}
            >
              {item.imageUrl && (
                <div className="flex-shrink-0">
                  <img 
                    src={item.imageUrl} 
                    alt={item.title}
                    className="w-32 h-20 object-cover rounded-md"
                    loading="lazy"
                  />
                </div>
              )}
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-3 mb-2">
                  <Badge variant="outline" className="flex-shrink-0">
                    #{item.rank}
                  </Badge>
                  <h3 className="font-medium text-sm leading-tight flex-1" data-testid={`text-item-title-${item.rank}`}>
                    {item.title}
                  </h3>
                </div>
                
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="font-mono font-semibold text-foreground" data-testid={`text-metric-${item.rank}`}>
                    {formatMetricValue(item.metricValue, metricName)} {metricName}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(item.timestamp)}
                  </span>
                </div>
                
                {item.link && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="mt-2 gap-2" 
                    asChild
                    data-testid={`button-view-${item.rank}`}
                  >
                    <a href={item.link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" />
                      View Original
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
