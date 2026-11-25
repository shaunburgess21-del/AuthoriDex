/**
 * Sentiment-poll ("People's Voice") card, extracted verbatim from VotePage so
 * it can render outside the Vote hub (snap view, Quick Vote overlay). The
 * vote mutation stays with the caller via `onVote` — the card only owns its
 * optimistic voted/result presentation and re-syncs from `topic.userVote`.
 */
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { InteractiveVotedPill } from "@/components/InteractiveVotedPill";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
import { ImageLightbox } from "@/components/ImageLightbox";
import { CardCommentsFocusOverlay } from "@/components/comments/CardComments";
import { CardVoteCount, DiscussionButton } from "@/components/comments/DiscussionButton";
import { Users, ThumbsUp, ThumbsDown, Minus, MessageSquare, type LucideIcon } from "lucide-react";
import { CrowdLine, type CrowdLineShare } from "@/components/vote/CrowdLine";
import { choiceCrowdLine } from "@/lib/crowdLine";
import { VoteCardHeader } from "@/components/vote/VoteCardHeader";
import { Link } from "wouter";
import { sentimentPollShare } from "@/lib/share";
import {
  getSentimentPollChoiceColor,
  getSentimentPollChoiceLabel,
  getSentimentPollVotedPillStyle,
} from "@/lib/sentimentPollVoteDisplay";
import { sentimentPollVoteKey } from "@shared/lib/sentiment-poll-vote-target";
import { toastUnhandledSentimentVoteError } from "@/lib/sentimentVoteFailure";

type SentimentChoice = "agree" | "neutral" | "disagree";

const SENTIMENT_RESULT_ROWS: Array<{
  choice: SentimentChoice;
  icon: LucideIcon;
  barClassName: string;
  percentKey: "agreePercent" | "neutralPercent" | "disagreePercent";
}> = [
  { choice: "agree", icon: ThumbsUp, barClassName: "bg-[#00C853]", percentKey: "agreePercent" },
  { choice: "neutral", icon: Minus, barClassName: "bg-slate-400", percentKey: "neutralPercent" },
  { choice: "disagree", icon: ThumbsDown, barClassName: "bg-[#FF0000]", percentKey: "disagreePercent" },
];

/**
 * Agree / Neutral / Disagree result row.
 *
 * The label and "Your pick" are one block, centred on that row's bar.
 * The caption renders only on the chosen option, so the other labels stay
 * on their bars' centres. Every row keeps the captioned min-height so
 * casting a vote does not reflow the card. The icon sits on the label
 * line; the percent stays centred with the bar.
 */
function SentimentChoiceResultRow({
  choice,
  voted,
  topicId,
  percent,
  icon: Icon,
  barClassName,
}: {
  choice: SentimentChoice;
  voted: SentimentChoice | null;
  topicId: string;
  percent: number;
  icon: LucideIcon;
  barClassName: string;
}) {
  const chosen = voted === choice;
  return (
    <div className="flex min-h-8 items-center gap-3" data-sentiment-choice={choice}>
      <div
        className="grid shrink-0 grid-cols-[1rem_4.5rem] items-center gap-x-3"
        style={{ color: getSentimentPollChoiceColor(choice) }}
      >
        <Icon className="col-start-1 row-start-1 h-4 w-4" />
        <span className="col-start-2 row-start-1 w-[4.5rem] whitespace-nowrap text-sm font-medium keep-descenders">
          {getSentimentPollChoiceLabel(choice)}
        </span>
        {chosen ? (
          <span
            className="col-start-2 row-start-2 whitespace-nowrap text-[9px] font-semibold leading-3 keep-descenders"
            data-testid={`badge-your-pick-${topicId}`}
          >
            Your pick
          </span>
        ) : null}
      </div>
      <div className="h-4 flex-1 self-center overflow-hidden rounded-full bg-white/5 md:h-3">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClassName}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-10 self-center text-right text-sm text-muted-foreground">{percent}%</span>
    </div>
  );
}

export function DiscourseCard({
  topic,
  onVote,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onNavigateToPollDetail,
  onBrowseFullScreen,
  enableDiscussion = false,
  categoryMenuDisabled = false,
  showTypeCue = false,
  feedLayout = false,
  imageLoading,
}: {
  topic: any;
  onVote: (choice: 'agree' | 'neutral' | 'disagree') => Promise<void>;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
  /** When set, detail links use history voteList + client navigation (Vote page). */
  onNavigateToPollDetail?: () => void;
  onBrowseFullScreen?: () => void;
  enableDiscussion?: boolean;
  categoryMenuDisabled?: boolean;
  /** Mixed All feed only: icon + "Agree?" between comments and the category pill. */
  showTypeCue?: boolean;
  /** Mixed All feed only: fill a fixed desktop row and pin the vote controls. */
  feedLayout?: boolean;
  /** Set by the mixed feed so off-screen cards stay lazy. */
  imageLoading?: "eager" | "lazy";
}) {
  const [voted, setVoted] = useState<'agree' | 'neutral' | 'disagree' | null>(topic.userVote || null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  // Blank slugs still have an id. Comments and the detail page resolve either key.
  const pollKey = sentimentPollVoteKey(topic);
  const showDiscussion = enableDiscussion && !!pollKey;
  const crowd = choiceCrowdLine(
    [
      { key: "agree", percent: topic.agreePercent },
      { key: "neutral", percent: topic.neutralPercent },
      { key: "disagree", percent: topic.disagreePercent },
    ],
    voted,
  );
  const crowdShare: CrowdLineShare | null =
    crowd && pollKey
      ? {
          headline: topic.headline,
          percent: crowd.userPercent,
          path: `/polls/${encodeURIComponent(pollKey)}`,
          surface: "poll",
        }
      : null;

  useEffect(() => {
    setVoted(topic.userVote ?? null);
  }, [topic.userVote]);

  const imgSources = [topic.personAvatar, topic.imageUrl].filter(Boolean) as string[];
  const [imgIdx, setImgIdx] = useState(0);

  useEffect(() => {
    setImgIdx(0);
  }, [topic.id, topic.imageUrl, topic.personAvatar]);

  const currentImgSrc = imgSources[imgIdx] ?? null;

  const handleImgError = () => {
    if (imgIdx + 1 < imgSources.length) {
      setImgIdx(imgIdx + 1);
    } else {
      setImgIdx(imgSources.length);
    }
  };

  const handleVote = async (choice: 'agree' | 'neutral' | 'disagree') => {
    if (voted) return;
    const prev = voted;
    setVoted(choice);
    try {
      await onVote(choice);
    } catch (err) {
      setVoted(prev);
      toastUnhandledSentimentVoteError(err);
    }
  };

  const handleChangeVote = () => {
    setVoted(null);
  };

  return (
    <div className={`hub-card-slot relative h-full ${feedLayout ? "md:min-h-0" : ""}`}>
    <Card 
      className={`hub-card-hover lb-row-neutral relative pt-5 px-4 sm:px-5 pb-4 sm:pb-5 ${voted ? "max-md:pb-2.5 md:pb-[14px]" : ""} bg-card/80 backdrop-blur-sm flex flex-col shadow-none md:shadow-sm rounded-[12px] md:rounded-xl ${feedLayout ? "h-auto min-h-[390px] md:h-full md:min-h-0 md:overflow-hidden" : "h-full min-h-[390px] md:min-h-[300px]"}`}
      data-testid={`card-discourse-${topic.id}`}
    >
      <VoteCardHeader
        kind={showTypeCue ? "sentiment" : null}
        leading={
          showDiscussion ? (
            <DiscussionButton
              count={topic.commentCount}
              onClick={() => setDiscussionOpen(true)}
              testId={`button-discussion-${topic.id}`}
            />
          ) : (
            <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
              <span className={voted ? "" : "text-slate-600"}>
                {voted ? `${topic.totalVotes.toLocaleString('en-US')} votes` : "Votes"}
              </span>
            </div>
          )
        }
        trailing={
          <InteractiveCategoryPill
            category={topic.category}
            onFilter={() => onFilterCategory(topic.category)}
            leaderboardCategories={leaderboardCategories}
            detailHref={pollKey ? `/polls/${pollKey}` : undefined}
            detailOnNavigate={onNavigateToPollDetail}
            detailLabel="View Poll Details"
            onBrowseFullScreen={onBrowseFullScreen}
            share={pollKey ? sentimentPollShare(pollKey, topic.headline) : undefined}
            reactionTarget={{ surfaceType: "sentiment_poll", targetId: String(topic.id) }}
            menuDisabled={categoryMenuDisabled}
            size="pollCard"
            data-testid={`badge-category-${topic.id}`}
          />
        }
      />
      <AvatarHeightHeadline
        className="mb-3"
        text={topic.headline}
        serif={false}
        href={onNavigateToPollDetail ? undefined : pollKey ? `/polls/${pollKey}` : undefined}
        onTitleNavigate={onNavigateToPollDetail}
        linkTestId={pollKey ? `link-poll-detail-${topic.id}` : undefined}
        avatar={
          currentImgSrc ? (
            <div
              className="h-16 w-16 rounded-md overflow-hidden shrink-0 bg-muted dark:bg-slate-800 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedImage(currentImgSrc);
              }}
            >
              <img
                src={currentImgSrc}
                alt={topic.personName || topic.headline}
                className="w-full h-full object-cover"
                loading={imageLoading}
                decoding={imageLoading ? "async" : undefined}
                onError={handleImgError}
              />
            </div>
          ) : (
            <div className="h-16 w-16 rounded-md bg-gradient-to-br from-slate-700/50 to-slate-800/50 flex items-center justify-center shrink-0">
              <MessageSquare className="h-5 w-5 text-slate-400" />
            </div>
          )
        }
      />
      {topic.subjectText && (
        pollKey && onNavigateToPollDetail ? (
          <button type="button" onClick={onNavigateToPollDetail} className="block mb-4 w-full text-left">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.subjectText}</p>
          </button>
        ) : pollKey ? (
          <Link href={`/polls/${pollKey}`} className="block mb-4">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.subjectText}</p>
          </Link>
        ) : (
          <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground mb-4 line-clamp-2">{topic.subjectText}</p>
        )
      )}
      {!topic.subjectText && topic.description && (
        pollKey && onNavigateToPollDetail ? (
          <button type="button" onClick={onNavigateToPollDetail} className="block mb-4 w-full text-left">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.description}</p>
          </button>
        ) : pollKey ? (
          <Link href={`/polls/${pollKey}`} className="block mb-4">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.description}</p>
          </Link>
        ) : (
          <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground mb-4 line-clamp-2">{topic.description}</p>
        )
      )}
      
      {!voted ? (
        <div className={`flex flex-col gap-3 mt-auto ${feedLayout ? "shrink-0" : ""}`}>
          <button
            onClick={() => handleVote('agree')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
            data-testid={`button-agree-${topic.id}`}
          >
            <ThumbsUp className="h-4 w-4 shrink-0" />
            <span>{getSentimentPollChoiceLabel("agree")}</span>
          </button>
          <button
            onClick={() => handleVote('neutral')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-muted/40 border border-border text-foreground dark:bg-white/5 dark:border-white/40 dark:text-white text-sm font-medium transition-all duration-300 hover:border-foreground/40 hover:bg-muted/60 dark:hover:border-white/80 dark:hover:bg-white/15"
            data-testid={`button-neutral-${topic.id}`}
          >
            <Minus className="h-4 w-4 shrink-0" />
            <span>{getSentimentPollChoiceLabel("neutral")}</span>
          </button>
          <button
            onClick={() => handleVote('disagree')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 md:py-2.5 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
            data-testid={`button-disagree-${topic.id}`}
          >
            <ThumbsDown className="h-4 w-4 shrink-0" />
            <span>{getSentimentPollChoiceLabel("disagree")}</span>
          </button>
        </div>
      ) : (
        <>
        <div className="flex flex-col gap-5 md:gap-3 my-auto md:mt-auto">
          {SENTIMENT_RESULT_ROWS.map((row) => (
            <SentimentChoiceResultRow
              key={row.choice}
              choice={row.choice}
              voted={voted}
              topicId={String(topic.id)}
              percent={Number(topic[row.percentKey] ?? 0)}
              icon={row.icon}
              barClassName={row.barClassName}
            />
          ))}
          <CrowdLine
            text={crowd?.text ?? null}
            share={crowdShare}
            testId={`crowd-line-poll-${topic.id}`}
          />
        </div>

        <div className="mt-auto flex min-h-7 items-center gap-2 pt-2 md:mt-2 md:pt-0">
            <div className="flex-1 min-w-0 flex items-center">
              {showDiscussion ? (
                <CardVoteCount count={topic.totalVotes} testId={`text-votes-${topic.id}`} />
              ) : null}
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              {pollKey &&
                (onNavigateToPollDetail ? (
                  <button
                    type="button"
                    onClick={onNavigateToPollDetail}
                    className="text-xs text-cyan-600 dark:text-cyan-400 transition-colors underline-offset-4 hover:underline"
                    data-testid={`link-poll-view-more-${topic.id}`}
                  >
                    More details
                  </button>
                ) : (
                  <Link
                    href={`/polls/${pollKey}`}
                    className="text-xs text-cyan-600 dark:text-cyan-400 transition-colors underline-offset-4 hover:underline inline-block"
                    data-testid={`link-poll-view-more-${topic.id}`}
                  >
                    More details
                  </Link>
                ))}
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-end">
              <InteractiveVotedPill
                label={voted ? getSentimentPollChoiceLabel(voted) : "You voted"}
                onChangeVote={handleChangeVote}
                onRemoveVote={handleChangeVote}
                pillStyle={getSentimentPollVotedPillStyle(voted)}
                data-testid={`badge-voted-${topic.id}`}
              />
            </div>
          </div>
        </>
      )}
    </Card>
    <ImageLightbox
      open={!!expandedImage}
      src={expandedImage ?? ""}
      alt={topic.personName || topic.headline}
      onClose={() => setExpandedImage(null)}
    />
    {showDiscussion && pollKey ? (
      <CardCommentsFocusOverlay
        open={discussionOpen}
        onClose={() => setDiscussionOpen(false)}
        entityType="poll"
        slug={pollKey}
        contextTitle={topic.headline}
      />
    ) : null}
    </div>
  );
}
