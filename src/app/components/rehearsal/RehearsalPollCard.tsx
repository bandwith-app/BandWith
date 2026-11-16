import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  AlertCircle,
  Trash2,
} from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import {
  togglePollVote,
  markPollUnavailable,
  pollAnsweredCount,
  finalizePollIntoRehearsal,
  POLL_CLOSED,
  declineProposal,
  deletePoll,
  cleanNotesWithoutDays,
  isPollVotingClosed,
  type RehearsalPoll,
} from '@/lib/services/rehearsalPolls';
import { PollDetails } from './PollDetails';
import { canDeletePoll, canVoteInPoll, canWithdrawProposal } from '@/lib/pollPermissions';
import { notifyProposalDeclined } from '@/lib/services/pollNotices';
import { proposalLastDay } from '@/lib/proposalExpiry';
import { ProposalDeclinePanel } from './ProposalDeclinePanel';
import { haptic } from '@/lib/haptics';
import { StepPad, Card, Tag, PillButton, PillField } from '@/app/components/bw';
import { personName } from '@/lib/personName';
import { useT, dateName, intlLocale, shortWeekday } from '@/lib/i18n';

interface RehearsalPollCardProps {
  poll: RehearsalPoll;
  currentUserId: string;
  isAdmin: boolean;
  onConvertProposal?: (poll: RehearsalPoll) => void;
  onPollUpdated?: () => void;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  defaultExpanded?: boolean;
}

export const RehearsalPollCard: React.FC<RehearsalPollCardProps> = ({
  poll,
  currentUserId,
  isAdmin,
  onConvertProposal,
  onPollUpdated,
  onShowToast,
  defaultExpanded = false,
}) => {
  const t = useT();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [votingOptionId, setVotingOptionId] = useState<string | null>(null);
  const [finalizingOptionId, setFinalizingOptionId] = useState<string | null>(null);
  const [showLocationInput, setShowLocationInput] = useState<string | null>(null); // optionId when admin clicks lock-in
  const [finalLocation, setFinalLocation] = useState(() => poll.location?.trim() || t('Band Practice Space'));
  const [declining, setDeclining] = useState(false);
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

  // Status checks
  const isProposed = poll.status === 'proposed';
  // Only what the database allows (073, 098): no vote pads for members not
  // invited to the poll, no Delete for a member once their proposal is a poll.
  const canVote = canVoteInPoll(poll, currentUserId);
  const canDelete = canDeletePoll(poll, currentUserId, isAdmin);

  // Calculate highest vote count among options
  const maxVotes = useMemo(() => {
    if (!poll.options || poll.options.length === 0) return 0;
    return Math.max(...poll.options.map((o) => o.vote_count || 0));
  }, [poll.options]);

  // Check if current user has voted on any option in this poll
  const hasUserVotedAny = useMemo(() => {
    if (!poll.options) return false;
    return poll.options.some((o) => o.has_voted);
  }, [poll.options]);

  // Members who answered: a vote, or "None work" (102)
  const answeredCount = useMemo(() => pollAnsweredCount(poll), [poll]);

  const totalMembers = poll.total_members_count || 1;

  // Auto-close countdown after voting (5 seconds)
  const [autoCloseCountdown, setAutoCloseCountdown] = useState<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAutoClose = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoCloseCountdown(null);
  }, []);

  const startAutoClose = useCallback(() => {
    clearAutoClose();
    setAutoCloseCountdown(5);

    countdownIntervalRef.current = setInterval(() => {
      setAutoCloseCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          // Don't auto-close if admin is currently entering location or confirming delete
          setShowLocationInput((currentLocationInput) => {
            setShowDeleteConfirm((currentDeleteConfirm) => {
              if (!currentLocationInput && !currentDeleteConfirm) {
                setExpanded(false);
              }
              return currentDeleteConfirm;
            });
            return currentLocationInput;
          });
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearAutoClose]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Cancel countdown if user manually collapses
  useEffect(() => {
    if (!expanded) {
      clearAutoClose();
    }
  }, [expanded, clearAutoClose]);

  // Toggle vote
  // After the vote-by deadline (117) the database refuses votes.
  const votingClosed = poll.status === 'polling' && isPollVotingClosed(poll);

  const handleToggleVote = async (optionId: string) => {
    if (!canVote || votingClosed) return;
    haptic.selection();
    setVotingOptionId(optionId);
    startAutoClose();
    const { error } = await togglePollVote(poll.id, optionId, currentUserId);
    setVotingOptionId(null);

    if (error) {
      clearAutoClose();
      onShowToast?.(t('Failed to register vote. Please try again.'), 'error');
    } else {
      onPollUpdated?.();
    }
  };

  // "None of these work"
  const handleNoneWork = async () => {
    if (!hasUserVotedAny || !canVote || votingClosed) return;
    startAutoClose();
    // Clears the votes and stores the answer (102) so the admin sees it.
    const { error } = await markPollUnavailable(poll.id, currentUserId);
    if (!error) {
      onShowToast?.(t('Cleared your availability for this poll.'), 'info');
      onPollUpdated?.();
    } else {
      clearAutoClose();
    }
  };

  // Finalize into official rehearsal
  const handleConfirmFinalize = async (optionId: string) => {
    setFinalizingOptionId(optionId);
    const { error } = await finalizePollIntoRehearsal({
      pollId: poll.id,
      winningOptionId: optionId,
      bandId: poll.band_id,
      location: finalLocation,
      notes: poll.notes || undefined,
      adminId: currentUserId,
    });
    setFinalizingOptionId(null);
    setShowLocationInput(null);

    if (error) {
      onShowToast?.(error.message || t('Failed to create rehearsal.'), 'error');
      // Locked in meanwhile (another admin or device): show the poll as it is now.
      if ((error as { code?: string }).code === POLL_CLOSED) onPollUpdated?.();
    } else {
      onShowToast?.(t('Rehearsal scheduled and added to the calendar!'), 'success');
      onPollUpdated?.();
    }
  };

  // Decline proposal: the member is told (inbox + push), with the reason if any.
  const handleDecline = async (reason: string) => {
    setDeclining(true);
    const { declined, error } = await declineProposal(poll.id);
    setDeclining(false);
    if (error) {
      onShowToast?.(t('Could not decline the proposal. Try again.'), 'error');
      return;
    }
    setShowDeclineConfirm(false);
    if (declined) {
      onShowToast?.(t('Proposal declined.'), 'info');
      void notifyProposalDeclined(poll, currentUserId, reason);
    } else {
      // Withdrawn or turned into a poll meanwhile.
      onShowToast?.(t('This proposal is no longer pending.'), 'info');
    }
    onPollUpdated?.();
  };

  // Permanently delete poll
  const handleDeletePoll = async () => {
    clearAutoClose();
    setIsDeleting(true);
    const { error } = await deletePoll(poll.id);
    setIsDeleting(false);
    setShowDeleteConfirm(false);

    if (error) {
      onShowToast?.(t('Failed to delete poll. Please try again.'), 'error');
    } else {
      onShowToast?.(t('Rehearsal poll deleted.'), 'info');
      onPollUpdated?.();
    }
  };

  // The member withdraws their own pending proposal (073: creator, status 'proposed').
  const handleWithdraw = async () => {
    setIsDeleting(true);
    const { error } = await deletePoll(poll.id);
    setIsDeleting(false);
    setShowWithdrawConfirm(false);
    if (error) {
      onShowToast?.(t('Could not withdraw the proposal. Try again.'), 'error');
    } else {
      onShowToast?.(t('Proposal withdrawn.'), 'info');
      onPollUpdated?.();
    }
  };

  // 1. PROPOSAL CARD (For proposed status)
  if (isProposed) {
    // Only show to band admins or the member who proposed it
    const isAuthor = poll.created_by === currentUserId;
    if (!isAdmin && !isAuthor) return null;
    const lastDay = proposalLastDay(poll.created_at, poll.preferred_days);

    return (
      <Card className="w-full gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="flex items-center gap-2 bw-label-sm text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-accent-rehearsal" />
              {isAuthor && !isAdmin ? t('Your rehearsal proposal') : t('Member rehearsal proposal')}
            </span>
            <h4 className="bw-h2 [overflow-wrap:anywhere]">{poll.title}</h4>
          </div>
          <Tag variant="subtle">{t('Pending admin')}</Tag>
        </div>

        {/* Proposer Details */}
        <p className="bw-body-sm text-muted-foreground">
          {t('Proposed by')}{' '}
          <span className="text-foreground font-semibold">
            {personName(poll.creator_profile, t('Band member'))}
          </span>{' '}
          ·{' '}
          {new Date(poll.created_at).toLocaleDateString(intlLocale(), {
            month: 'short',
            day: 'numeric',
          })}
        </p>

        {/* Preferred Days */}
        {poll.preferred_days && poll.preferred_days.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="bw-label-sm text-muted-foreground mr-1">{t('Preferred days')}</span>
            {poll.preferred_days.map((day) => (
              <Tag key={day} variant="rehearsal">
                {shortWeekday(day)}
              </Tag>
            ))}
          </div>
        )}

        {/* Optional Notes */}
        {cleanNotesWithoutDays(poll.notes) && <p className="bw-body-md">{cleanNotesWithoutDays(poll.notes)}</p>}

        {/* It lapses after its last day (proposalExpiry.ts) */}
        {lastDay && (
          <p className="bw-body-sm text-muted-foreground">
            {t('Open until {date}', {
              date: dateName(new Date(lastDay + 'T12:00:00'), { weekday: 'short', day: 'numeric', month: 'short' }),
            })}
          </p>
        )}

        {/* The proposer: withdraw it while it is pending */}
        {!isAdmin && canWithdrawProposal(poll, currentUserId) &&
          (!showWithdrawConfirm ? (
            <div className="flex items-center justify-end">
              <PillButton variant="ghost" size="sm" fullWidth={false} onClick={() => setShowWithdrawConfirm(true)}>
                {t('Withdraw')}
              </PillButton>
            </div>
          ) : (
            <div
              role="alertdialog"
              aria-labelledby={`proposal-withdraw-${poll.id}`}
              className="flex flex-col gap-3 p-4 rounded-[16px] border-2 border-destructive"
            >
              <div className="flex flex-col gap-1">
                <span id={`proposal-withdraw-${poll.id}`} className="bw-h3 text-destructive">
                  {t('Withdraw your proposal?')}
                </span>
                <p className="bw-body-sm text-muted-foreground">{t('The admins will no longer see it.')}</p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <PillButton variant="ghost" size="sm" fullWidth={false} disabled={isDeleting} onClick={() => setShowWithdrawConfirm(false)}>
                  {t('Cancel')}
                </PillButton>
                <PillButton variant="danger" size="sm" fullWidth={false} loading={isDeleting} onClick={handleWithdraw}>
                  {t('Withdraw')}
                </PillButton>
              </div>
            </div>
          ))}

        {/* Admin Actions */}
        {isAdmin && showDeclineConfirm && (
          <ProposalDeclinePanel
            id={`proposal-decline-${poll.id}`}
            name={personName(poll.creator_profile, t('Band member'))}
            busy={declining}
            onCancel={() => setShowDeclineConfirm(false)}
            onConfirm={handleDecline}
          />
        )}
        {isAdmin && !showDeclineConfirm && (
          <div className="flex items-center justify-end gap-2">
            <PillButton variant="ghost" size="sm" fullWidth={false} onClick={() => setShowDeclineConfirm(true)}>
              {t('Decline')}
            </PillButton>
            <PillButton
              variant="dark"
              size="sm"
              fullWidth={false}
              onClick={() => onConvertProposal?.(poll)}
              icon={<ArrowUpRight className="w-4 h-4" />}
            >
              {t('Build poll')}
            </PillButton>
          </div>
        )}
      </Card>
    );
  }

  // 2. ACTIVE AVAILABILITY POLL CARD (For polling status)
  // Figma "Action card": dark card, status row, title, and one Step Pad per
  // option. Tapping a pad toggles your availability; "Details" opens the
  // full list (lock-in, delete, "none work").
  const padOptions = poll.options.slice(0, 8);
  return (
    <div className="dark w-full bg-sheet text-sheet-foreground rounded-[24px] relative overflow-hidden">
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 bw-label-sm">
            <span className="w-2 h-2 rounded-full bg-destructive-solid" />
            {t('Poll · Active')}
          </span>
          <span
            className={cn(
              'h-4 px-1.5 rounded-full inline-flex items-center bw-label-xs',
              hasUserVotedAny || !canVote || votingClosed ? 'bg-white/15 text-white' : 'bg-accent text-accent-foreground'
            )}
          >
            {votingClosed ? t('Voting closed') : !canVote ? t('Not invited') : hasUserVotedAny ? t('Voted') : poll.declined_all ? t('None work') : t('Vote now')}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="bw-h2 text-white">{poll.title}</h4>
          <p className="bw-body-sm text-white/75">
            {cleanNotesWithoutDays(poll.notes) ? `${cleanNotesWithoutDays(poll.notes)} — ` : t('Select your available options — ')}
            {t('{answered} of {total} answered', { answered: answeredCount, total: totalMembers })}
          </p>
          <PollDetails poll={{ ...poll, total_members_count: totalMembers }} className="text-white/85" />
        </div>

        <div className="grid grid-cols-3 gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, padOptions.length))}, minmax(0, 1fr))` }}>
          {padOptions.map((option) => {
            const d = new Date(option.proposed_date + 'T12:00:00');
            const count = option.vote_count || 0;
            const slots = Math.min(Math.max(totalMembers, count, 1), 8);
            return (
              <StepPad
                key={option.id}
                onDark
                selected={!!option.has_voted}
                disabled={!canVote || votingClosed || votingOptionId === option.id}
                day={dateName(d, { weekday: 'short' }).toUpperCase()}
                date={d.getDate()}
                time={`${(option.start_time || '').slice(0, 5)}${option.end_time ? `–${option.end_time.slice(0, 5)}` : ''}`}
                votes={Array.from({ length: slots }, (_, i) => i < count)}
                onClick={() => handleToggleVote(option.id)}
              />
            );
          })}
        </div>

        {!canVote && (
          <p className="bw-body-sm text-white/75">{t("You're not on this poll's invite list, so you can't vote.")}</p>
        )}

        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            clearAutoClose();
            setExpanded((prev) => !prev);
          }}
          className="self-start flex items-center gap-1.5 bw-label-sm text-white/70 hover:text-white transition-colors cursor-pointer"
        >
          {expanded ? t('Hide details') : isAdmin ? t('Details · Lock in') : t('Details')}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Expanded Candidate Options List */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 min-h-9">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="bw-label-sm text-white/70">{t('Your availability')}</span>
                  {autoCloseCountdown !== null && (
                    <span className="flex items-center gap-2 bw-label-sm text-white/70">
                      <span className="animate-pulse">· {t('Closing in {seconds}s', { seconds: autoCloseCountdown })}</span>
                      <button
                        type="button"
                        onClick={clearAutoClose}
                        className="underline underline-offset-2 text-white hover:opacity-80"
                      >
                        {t('Keep open')}
                      </button>
                    </span>
                  )}
                </div>

                {hasUserVotedAny && canVote && !votingClosed && (
                  <PillButton variant="ghost" size="sm" fullWidth={false} className="-mr-3 shrink-0" onClick={handleNoneWork}>
                    {t('None work')}
                  </PillButton>
                )}
              </div>

              {/* Candidate Options */}
              <div className="flex flex-col gap-2">
                {poll.options.map((option) => {
                  const parsedDate = new Date(option.proposed_date + 'T12:00:00');
                  const isWinning = maxVotes > 0 && (option.vote_count || 0) === maxVotes;
                  const isChecked = !!option.has_voted;
                  const isFinalizing = finalizingOptionId === option.id;
                  const isSelectingLocation = showLocationInput === option.id;

                  return (
                    <div
                      key={option.id}
                      className={cn(
                        'rounded-[16px] p-4 flex flex-col gap-3 transition-colors',
                        isChecked ? 'bg-accent text-accent-foreground' : 'bg-white/[0.08] text-white'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {/* Toggle vote */}
                        <button
                          type="button"
                          aria-pressed={isChecked}
                          disabled={!canVote || votingClosed || votingOptionId === option.id}
                          onClick={() => handleToggleVote(option.id)}
                          className="flex-1 min-w-0 flex flex-col gap-1 text-left cursor-pointer select-none"
                        >
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="bw-body-lg whitespace-nowrap">
                              {parsedDate.toLocaleDateString(intlLocale(), {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                            {isWinning && (
                              <Tag variant={isChecked ? 'solid' : 'accent'} className={isChecked ? 'bg-black text-white' : undefined}>
                                {t('Top pick')}
                              </Tag>
                            )}
                          </span>
                          <span className="bw-body-sm opacity-75 min-w-0 [overflow-wrap:anywhere]">
                            {option.start_time}
                            {option.end_time ? ` – ${option.end_time}` : ''} · {t('{count}/{total} available', { count: option.vote_count || 0, total: totalMembers })}
                          </span>
                        </button>

                        {/* Admin Action: Lock In Slot */}
                        {isAdmin && (
                          <PillButton
                            size="sm"
                            fullWidth={false}
                            variant={isChecked ? 'dark' : isWinning ? 'primary' : 'outline'}
                            className={isChecked ? 'bg-black text-white' : undefined}
                            aria-expanded={isSelectingLocation}
                            onClick={() => {
                              clearAutoClose();
                              setShowLocationInput(isSelectingLocation ? null : option.id);
                            }}
                          >
                            {t('Lock in')}
                          </PillButton>
                        )}
                      </div>

                      {/* Voters */}
                      {option.votes && option.votes.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {option.votes.map((v) => {
                            const initials = v.profile?.full_name
                              ? v.profile.full_name
                                  .split(' ')
                                  .map((n) => n[0])
                                  .join('')
                                  .slice(0, 2)
                                  .toUpperCase()
                              : 'MB';

                            return (
                              <span
                                key={v.id}
                                title={personName(v.profile)}
                                className="w-7 h-7 rounded-full border border-current/40 bw-label-xs flex items-center justify-center shrink-0 overflow-hidden"
                              >
                                {v.profile?.avatar_url ? (
                                  <img src={v.profile.avatar_url} alt={v.profile?.full_name || t('Voter')} className="w-full h-full object-cover" />
                                ) : (
                                  initials
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Admin Location Prompt when clicking Lock In */}
                      {isAdmin && isSelectingLocation && (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex flex-col gap-3 p-4 -mx-1 rounded-[16px] bg-sheet text-white"
                        >
                          <PillField
                            tone="sheet"
                            label={t('Rehearsal location')}
                            icon={<MapPin className="w-5 h-5" />}
                            value={finalLocation}
                            onChange={(e) => setFinalLocation(e.target.value)}
                            placeholder={t('Location / practice studio')}
                          />
                          <PillButton
                            size="md"
                            loading={isFinalizing}
                            icon={<Check className="w-4 h-4" />}
                            onClick={() => handleConfirmFinalize(option.id)}
                          >
                            {t('Confirm & create event')}
                          </PillButton>
                        </motion.div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Admin, or the creator of a proposal: Delete Poll with Confirmation */}
              {canDelete &&
                (!showDeleteConfirm ? (
                  <PillButton
                    variant="danger"
                    size="sm"
                    fullWidth={false}
                    className="self-start -ml-3"
                    icon={<Trash2 className="w-4 h-4" />}
                    onClick={() => {
                      clearAutoClose();
                      setShowDeleteConfirm(true);
                    }}
                  >
                    {t('Delete poll')}
                  </PillButton>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    role="alertdialog"
                    aria-labelledby={`poll-delete-${poll.id}`}
                    className="flex flex-col gap-3 p-4 rounded-[16px] border-2 border-destructive"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
                      <div className="flex flex-col gap-1">
                        <span id={`poll-delete-${poll.id}`} className="bw-h3 text-destructive">
                          {t('Delete rehearsal poll?')}
                        </span>
                        <p className="bw-body-sm text-white/80">
                          {t('All proposed dates and member votes will be permanently deleted. This cannot be undone.')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <PillButton
                        variant="ghost"
                        size="sm"
                        fullWidth={false}
                        disabled={isDeleting}
                        onClick={() => setShowDeleteConfirm(false)}
                      >
                        {t('Cancel')}
                      </PillButton>
                      <PillButton
                        size="sm"
                        fullWidth={false}
                        loading={isDeleting}
                        icon={<Trash2 className="w-4 h-4" />}
                        className="bg-destructive-solid text-white"
                        onClick={handleDeletePoll}
                      >
                        {isDeleting ? t('Deleting…') : t('Delete poll')}
                      </PillButton>
                    </div>
                  </motion.div>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
