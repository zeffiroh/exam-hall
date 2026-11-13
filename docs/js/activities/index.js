export const KINDS = {
  exam: { label: 'Exam', blurb: 'Timed test with question sets, auto-marking and teacher grading', icon: '📝' },
  movie: { label: 'Movie night', blurb: 'Watch a video together, in sync', icon: '🎬' },
  dj: { label: 'Study DJ', blurb: 'Study music with search, a live visualizer and requests', icon: '🎧' }
};

export const kindInfo = k => KINDS[k] || { label: k, blurb: '', icon: '🧩' };

export function openUrl(a, host = false) {
  if (a.kind === 'exam' && !host) return 'exam.html?a=' + encodeURIComponent(a.slug);
  return 'activity.html?a=' + encodeURIComponent(a.slug) + (host ? '&host=1' : '');
}

export async function loadKind(kind) {
  if (!/^[a-z0-9-]+$/.test(kind)) throw new Error('Unknown activity');
  return (await import('./' + kind + '.js')).default;
}
