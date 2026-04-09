/**
 * Locale-neutral value stored in diff refs when Git returns no textual diff.
 * UI layers should show `t('changes.noDiff')` when comparing to this sentinel.
 */
export const EMPTY_DIFF_SENTINEL = '__GITFORK_NO_DIFF__'
