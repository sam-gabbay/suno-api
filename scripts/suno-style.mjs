// Reads the exact recipe (style, exclusions, lyrics, model) behind a Suno song.
const UUID = /[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/i;
const SUNO_HOST = /(^|\.)suno\.(com|ai)$/i;

/**
 * Accepts a clip ID or a suno.com link and returns { id } or { shortLink }.
 * Short share links (suno.com/s/...) have to be resolved over the network.
 */
export function parseSunoInput(input) {
  const text = String(input).trim();
  const bare = text.match(new RegExp(`^${UUID.source}$`, 'i'));
  if (bare) return { id: bare[0].toLowerCase() };
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' || !SUNO_HOST.test(url.hostname)) return null;
  const id = url.pathname.match(UUID);
  if (id) return { id: id[0].toLowerCase() };
  if (/^\/s\/[\w-]+\/?$/.test(url.pathname)) return { shortLink: `https://suno.com${url.pathname.replace(/\/$/, '')}` };
  return null;
}

/** Follows a suno.com/s/... share link to the song's clip ID without sending any credentials. */
export async function resolveShortLink(link, fetchImpl = fetch) {
  let current = link;
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const location = response.headers.get('location');
    const found = (location || '').match(UUID);
    if (found) return found[0].toLowerCase();
    if (!location || response.status < 300 || response.status >= 400) {
      const body = await response.text().catch(() => '');
      const inPage = body.match(new RegExp(`/song/(${UUID.source})`, 'i'));
      if (inPage) return inPage[1].toLowerCase();
      break;
    }
    const next = new URL(location, current);
    if (next.protocol !== 'https:' || !SUNO_HOST.test(next.hostname)) break;
    current = next.href;
  }
  throw new Error('Could not find the song behind that share link. Open it in a browser and copy the suno.com/song/... address instead.');
}

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The parts of a raw Suno clip that matter for recreating its style. */
export function sunoRecipe(clip) {
  if (!clip || typeof clip !== 'object' || !clip.id) throw new Error('Suno did not return a song for that ID.');
  const meta = clip.metadata || {};
  const recipe = {
    id: clip.id,
    title: clean(clip.title),
    creator: clean(clip.display_name) || clean(clip.handle),
    model: clean(clip.model_name),
    model_version: clean(clip.major_model_version),
    style: clean(meta.tags),
    exclude: clean(meta.negative_tags),
    description_prompt: clean(meta.gpt_description_prompt),
    lyrics: clean(meta.prompt),
    instrumental: meta.make_instrumental === true || meta.has_vocal === false,
    type: clean(meta.type),
    duration_seconds: Number.isFinite(meta.duration) ? Math.round(meta.duration) : null,
    persona_id: clean(meta.persona_id) || clean(clip.persona?.id),
    persona_name: clean(clip.persona?.name),
    sliders: meta.control_sliders && typeof meta.control_sliders === 'object' ? meta.control_sliders : null,
    history: Array.isArray(meta.history) ? meta.history.map((h) => clean(h?.id)).filter(Boolean) : [],
    audio_url: clean(clip.audio_url),
    public: clip.is_public === true,
  };
  // An upload has no Suno style to copy; its audio has to be measured instead.
  recipe.uploaded_audio = recipe.type === 'upload' || (!recipe.style && !recipe.description_prompt && recipe.type !== 'gen');
  return recipe;
}

/** Request body for /api/custom_generate that keeps the style and swaps in new lyrics. */
export function sameStyleRequest(recipe, lyrics = '[Verse]\n<your new lyrics>') {
  const body = {
    prompt: recipe.instrumental ? '' : lyrics,
    tags: recipe.style || '',
    title: '<new title>',
    make_instrumental: recipe.instrumental,
    wait_audio: false,
  };
  if (recipe.exclude) body.negative_tags = recipe.exclude;
  return body;
}

/** Only fetch audio from Suno's own hosts. */
export function isSunoAudioUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SUNO_HOST.test(url.hostname);
  } catch {
    return false;
  }
}
