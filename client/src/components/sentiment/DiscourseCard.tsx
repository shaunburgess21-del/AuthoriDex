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
import { DiscussionButton } from "@/components/comments/DiscussionButton";
import { Users, ThumbsUp, ThumbsDown, Minus, MessageSquare } from "lucide-react";
import { Link } from "wouter";
import { sentimentPollShare } from "@/lib/share";
import {
  getSentimentPollChoiceColor,
  getSentimentPollChoiceLabel,
  getSentimentPollVotedPillStyle,
} from "@/lib/sentimentPollVoteDisplay";

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
}) {
  const [voted, setVoted] = useState<'agree' | 'neutral' | 'disagree' | null>(topic.userVote || null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const showDiscussion = enableDiscussion && !!topic.slug;

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
    } catch {
      setVoted(prev);
    }
  };

  const handleChangeVote = () => {
    setVoted(null);
  };

  return (
    <div className="hub-card-slot relative h-full">
    <Card 
      className={`hub-card-hover lb-row-neutral relative pt-5 px-4 sm:px-5 pb-4 sm:pb-5 ${voted ? "max-md:pb-2.5 md:pb-[14px]" : ""} bg-card/80 backdrop-blur-sm h-full min-h-[390px] md:min-h-[300px] flex flex-col shadow-none md:shadow-sm rounded-[12px] md:rounded-xl`}
      data-testid={`card-discourse-${topic.id}`}
    >
      <div className="absolute top-3 right-3">
        <InteractiveCategoryPill
          category={topic.category}
          onFilter={() => onFilterCategory(topic.category)}
          leaderboardCategories={leaderboardCategories}
          detailHref={topic.slug ? `/polls/${topic.slug}` : undefined}
          detailOnNavigate={onNavigateToPollDetail}
          detailLabel="View Poll Details"
          onBrowseFullScreen={onBrowseFullScreen}
          share={topic.slug ? sentimentPollShare(topic.slug, topic.headline) : undefined}
          menuDisabled={categoryMenuDisabled}
          size="pollCard"
          data-testid={`badge-category-${topic.id}`}
        />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
        <span className={voted ? "" : "text-slate-600"}>
          {voted ? `${topic.totalVotes.toLocaleString('en-US')} votes` : "Votes"}
        </span>
      </div>
      <AvatarHeightHeadline
        className="mb-3"
        text={topic.headline}
        serif={false}
        href={onNavigateToPollDetail ? undefined : topic.slug ? `/polls/${topic.slug}` : undefined}
        onTitleNavigate={onNavigateToPollDetail}
        linkTestId={topic.slug ? `link-poll-detail-${topic.id}` : undefined}
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
        topic.slug && onNavigateToPollDetail ? (
          <button type="button" onClick={onNavigateToPollDetail} className="block mb-4 w-full text-left">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.subjectText}</p>
          </button>
        ) : topic.slug ? (
          <Link href={`/polls/${topic.slug}`} className="block mb-4">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.subjectText}</p>
          </Link>
        ) : (
          <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground mb-4 line-clamp-2">{topic.subjectText}</p>
        )
      )}
      {!topic.subjectText && topic.description && (
        topic.slug && onNavigateToPollDetail ? (
          <button type="button" onClick={onNavigateToPollDetail} className="block mb-4 w-full text-left">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.description}</p>
          </button>
        ) : topic.slug ? (
          <Link href={`/polls/${topic.slug}`} className="block mb-4">
            <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">{topic.description}</p>
          </Link>
        ) : (
          <p className="text-[17px] md:text-[16px] leading-[1.5] md:leading-[1.4] text-muted-foreground mb-4 line-clamp-2">{topic.description}</p>
        )
      )}
      
      {!voted ? (
        <div className="flex flex-col gap-3 mt-auto">
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
          <div className="flex items-center gap-3">
            <ThumbsUp className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("agree") }} />
            <span
              className="text-sm w-[4.5rem] shrink-0 font-medium whitespace-nowrap"
              style={{ color: getSentimentPollChoiceColor("agree") }}
            >
              {getSentimentPollChoiceLabel("agree")}
            </span>
            <div className="flex-1 h-4 md:h-3 bg-white/5 rounded-full overflow-hidden self-center">
              <div 
                className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                style={{ width: `${topic.agreePercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.agreePercent}%</span>
          </div>
          
          <div className="flex items-center gap-3">
            <Minus className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("neutral") }} />
            <span
              className="text-sm w-[4.5rem] shrink-0 font-medium whitespace-nowrap"
              style={{ color: getSentimentPollChoiceColor("neutral") }}
            >
              {getSentimentPollChoiceLabel("neutral")}
            </span>
            <div className="flex-1 h-4 md:h-3 bg-white/5 rounded-full overflow-hidden self-center">
              <div 
                className="h-full bg-slate-400 rounded-full transition-all duration-500"
                style={{ width: `${topic.neutralPercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.neutralPercent}%</span>
          </div>
          
          <div className="flex items-center gap-3">
            <ThumbsDown className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("disagree") }} />
            <span
              className="text-sm w-[4.5rem] shrink-0 font-medium whitespace-nowrap"
              style={{ color: getSentimentPollChoiceColor("disagree") }}
            >
              {getSentimentPollChoiceLabel("disagree")}
            </span>
            <div className="flex-1 h-4 md:h-3 bg-white/5 rounded-full overflow-hidden self-center">
              <div 
                className="h-full bg-[#FF0000] rounded-full transition-all duration-500"
                style={{ width: `${topic.disagreePercent}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{topic.disagreePercent}%</span>
          </div>
        </div>

        <div className="mt-auto md:mt-2 flex items-center gap-2 pt-3 md:pt-[22px] border-t border-white/10">
            <div className="flex-1 min-w-0 flex items-center">
              {showDiscussion ? (
                <DiscussionButton
                  count={topic.commentCount}
                  onClick={() => setDiscussionOpen(true)}
                  testId={`button-discussion-${topic.id}`}
                />
              ) : null}
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              {topic.slug &&
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
                    href={`/polls/${topic.slug}`}
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
    {showDiscussion && topic.slug ? (
      <CardCommentsFocusOverlay
        open={discussionOpen}
        onClose={() => setDiscussionOpen(false)}
        entityType="poll"
        slug={topic.slug}
        contextTitle={topic.headline}
      />
    ) : null}
    </div>
  );
}
