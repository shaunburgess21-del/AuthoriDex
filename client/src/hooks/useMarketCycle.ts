import { useState, useEffect, useCallback } from "react";

export type MarketStatus = "OPEN" | "CLOSED";

export interface MarketCycleState {
  status: MarketStatus;
  timeRemaining: {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    totalSeconds: number;
  };
  deadline: Date;
  urgencyLevel: "normal" | "warning" | "critical";
}

function getNextSundayMidnight(): Date {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  
  const nextSunday = new Date(now);
  nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  nextSunday.setUTCHours(23, 59, 59, 999);
  
  if (now > nextSunday) {
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
  }
  
  return nextSunday;
}

function calculateTimeRemaining(deadline: Date): MarketCycleState["timeRemaining"] {
  const now = new Date();
  const diff = Math.max(0, deadline.getTime() - now.getTime());
  
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;
  
  return { days, hours, minutes, seconds, totalSeconds };
}

function getUrgencyLevel(totalSeconds: number): MarketCycleState["urgencyLevel"] {
  const oneHour = 60 * 60;
  const twentyFourHours = 24 * 60 * 60;
  
  if (totalSeconds <= oneHour) return "critical";
  if (totalSeconds <= twentyFourHours) return "warning";
  return "normal";
}

export function useMarketCycle(): MarketCycleState {
  const [deadline] = useState(() => getNextSundayMidnight());
  const [timeRemaining, setTimeRemaining] = useState(() => calculateTimeRemaining(deadline));
  
  const updateTime = useCallback(() => {
    const remaining = calculateTimeRemaining(deadline);
    setTimeRemaining(remaining);
  }, [deadline]);
  
  useEffect(() => {
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [updateTime]);
  
  const status: MarketStatus = timeRemaining.totalSeconds > 0 ? "OPEN" : "CLOSED";
  const urgencyLevel = getUrgencyLevel(timeRemaining.totalSeconds);
  
  return {
    status,
    timeRemaining,
    deadline,
    urgencyLevel,
  };
}
