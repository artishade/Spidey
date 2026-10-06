/* Standalone signal engine: a faithful port of the local JEV analyzer (jev.py).
   Pure functions only, so the service worker and Node tests share one implementation. */
(() => {
  const TOPICS = {
    agents: /\b(agent[s]?|agentic|llm|language model|artificial intelligence|агент\w*|нейросет\w*|искусственн\w+ интеллект\w*)\b/i,
    robotics: /\b(robot[s]?|robotics|humanoid|drone[s]?|робот\w*|дрон\w*)\b/i,
    privacy: /\b(privacy|encryption|zero.knowledge|cryptography|приватност\w*|шифрован\w*|криптограф\w*)\b/i,
    devtools: /\b(compiler|debugger|developer tool|database|open.source|компилятор\w*|отладчик\w*|открыт\w+ код\w*)\b/i,
    science: /\b(fusion|quantum|telescope|spacecraft|satellite|квантов\w*|телескоп\w*|спутник\w*)\b/i,
  };
  // Majors and fiat are everywhere; they never mark an early narrative.
  const COMMON_CASHTAGS = new Set('BTC ETH SOL USD USDT USDC BNB XRP EUR DOGE SPX SPY QQQ NVDA TSLA AAPL'.split(' '));
  const CASHTAG = /(?<![\w$])\$([A-Za-z][A-Za-z0-9]{1,9})(?![\w$])/g;
  const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ADDRESS = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
  const WORD = /[a-zа-яё][a-zа-яё0-9]{2,}/g;
  const STOPWORDS = new Set('the and for you your this that with from have has are was were will just not but all can out about what when who how they them their our its into than then more most very new now get got one like been being also only over some any here there would could should these those which while where make made much many just today tomorrow week year time post thread link check read это как что все для или так уже еще ещё был была были его она они мне нас вам вас там тут при над под без про чем чтобы когда если только очень сейчас сегодня завтра тоже будет есть нет него неё ней себя свой своя свои этот эта эти тот'.split(' '));
  const RISK = /seed phrase|private key|guaranteed profit|connect wallet to claim/i;
  const MAX_PER_KIND = 10, WINDOW_RECENT = 6 * 3600, WINDOW_PREVIOUS = 18 * 3600, RETENTION = 7 * 86400, STORE_LIMIT = 500;

  function cashtags(text) {
    const out = new Set();
    for (const m of text.matchAll(CASHTAG))out.add(m[1].toUpperCase());
    for (const tag of COMMON_CASHTAGS)out.delete(tag);
    return out;
  }
  function isSolanaAddress(value) {
    let number = 0n;
    for (const char of value) {
      const index = BASE58.indexOf(char);
      if (index < 0)return false;
      number = number * 58n + BigInt(index);
    }
    const zeros = value.length - value.replace(/^1+/, '').length;
    const bits = number === 0n ? 0 : number.toString(2).length;
    return zeros + ((bits + 7) >> 3) === 32; // A real address decodes from base58 to exactly 32 bytes.
  }
  function solanaAddresses(text) {
    const out = new Set();
    for (const m of text.matchAll(ADDRESS))if (isSolanaAddress(m[0]))out.add(m[0]);
    return out;
  }
  function phrases(text) {
    // Adjacent word pairs mapped to their position; a stopword breaks the pair.
    const cleaned = text.toLowerCase().replace(/https?:\/\/\S+|[@$#]\w+/g, '');
    const words = cleaned.match(WORD) || [];
    const found = {};
    for (let i = 0; i < words.length - 1; i++) {
      const pair = [words[i], words[i + 1]];
      if (!pair.some(word => STOPWORDS.has(word)))found[pair.join(' ')] ??= i;
    }
    return found;
  }
  function topicList() {return Object.values(TOPICS);}
  function emergingPhrases(posts, now, minAuthors = 3, limit = 5) {
    // Two-word phrases repeated by distinct authors in the last 6h, outside every known topic.
    const recent = posts.filter(p => now - p.timestamp < WINDOW_RECENT);
    const groups = {};
    for (const p of recent)for (const phrase in phrases(p.text))(groups[phrase] ??= []).push(p);
    const found = [];
    for (const [phrase, group] of Object.entries(groups)) {
      const authors = new Set(group.map(p => p.author.toLowerCase()));
      if (authors.size < minAuthors || topicList().some(regex => regex.test(phrase)))continue;
      // Mostly inside one known topic means it is that topic's wording, not a new narrative.
      if (topicList().some(regex => group.filter(p => regex.test(p.text)).length * 2 > group.length))continue;
      // Earlier in the post usually names the thing; later pairs are commentary.
      const position = group.reduce((sum, p) => sum + phrases(p.text)[phrase], 0) / group.length;
      found.push([phrase, authors.size, group, position]);
    }
    found.sort((a, b) => b[1] - a[1] || b[2].length - a[2].length || a[3] - b[3] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const picked = [];
    for (const [phrase, , group] of found) {
      const ids = new Set(group.map(p => p.id));
      // Overlapping bigrams from one sentence are one narrative, not several.
      if (picked.some(([, g]) => {
        const gids = new Set(g.map(p => p.id));
        return [...ids].every(id => gids.has(id)) || [...gids].every(id => ids.has(id));
      }))continue;
      picked.push([phrase, posts.filter(p => phrase in phrases(p.text))]);
      if (picked.length === limit)break;
    }
    return picked;
  }
  function velocity(group, now) {
    // Mentions in the last 6h against the hourly pace of the 18h before them.
    const recent = group.filter(p => now - p.timestamp < WINDOW_RECENT);
    const previous = group.filter(p => WINDOW_RECENT <= now - p.timestamp && now - p.timestamp < WINDOW_RECENT + WINDOW_PREVIOUS);
    return {recent: recent.length, previous: previous.length,
      growth: previous.length ? Math.round((recent.length / 6) / (previous.length / 18) * 10) / 10 : null,
      growth_window: '6h vs prev 18h',
      recent_authors: new Set(recent.map(p => p.author.toLowerCase())).size,
      first_seen: Math.min(...group.map(p => p.captured_at ?? p.timestamp)),
      first_posted: Math.min(...group.map(p => p.timestamp))};
  }
  function candidate(group, kind, key, ident, name, now) {
    group = [...group].sort((a, b) => b.timestamp - a.timestamp);
    const authors = new Set(group.map(p => p.author.toLowerCase()));
    // Remove URLs and normalize punctuation to detect repeated promotional text.
    const texts = new Set(group.map(p => p.text.toLowerCase().replace(/https?:\/\/\S+|[^\w\s]/g, '').trim()));
    const duplicate = 1 - texts.size / group.length;
    const risks = group.some(p => RISK.test(p.text));
    const checks = [
      ['lookout', authors.size >= 4, `${authors.size} distinct visible authors. This is a sample of the open tab, not the whole X feed.`],
      ['maker', group.some(p => (p.links || []).length > 0), 'External project links observed; inspect crawler evidence for product claims.'],
      ['skeptic', duplicate <= .35 && !risks, `${Math.round(duplicate * 100)}% repeated text. Account authenticity is unverified.`],
      ['runner', group.length >= 5, `${group.length} captured posts within 24h; enough for a research lead, not an investment decision.`]];
    const votes = checks.map(([seat, ok, reason]) => ({seat, vote: seat === 'skeptic' && risks ? 'reject' : ok ? 'pass' : 'hold', reason}));
    const status = risks ? 'rejected' : checks.every(c => c[1]) ? 'shortlisted' : 'held';
    const result = {id: ident, name, url: group[group.length - 1].url, source: 'spider', kind, key, status,
      score: checks.filter(c => c[1]).length * 25, votes, observed_at: group[0].timestamp,
      updated: new Date(now * 1000).toISOString(),
      signals: {mentions: group.length, authors: authors.size, duplicate_ratio: duplicate, ...velocity(group, now)},
      evidence: {synthetic: false, errors: [], pages: group.slice(0, 8).map(p => ({url: p.url, kind: 'captured post', text: p.text, fetched_at: p.captured_at}))},
      posts: group.slice(0, 20)};
    if (kind === 'topic')result.topic = key;else result.research_only = true;
    return result;
  }
  function digest(text) {
    // Stable short id for phrases; not security-sensitive, so a simple hash suffices.
    let value = 5381;
    for (let i = 0; i < text.length; i++)value = ((value << 5) + value + text.charCodeAt(i)) >>> 0;
    return value.toString(16).padStart(8, '0').repeat(2).slice(0, 12);
  }
  function hydrate(raw, now) {
    // Fill in what the capture did not carry, mirroring the engine's normalize_capture.
    try {
      const url = new URL(raw.url);
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,30})\/status\/(\d{1,30})$/);
      const stamp = new Date(raw.created_at);
      if (url.protocol !== 'https:' || !match || !raw.text?.trim() || isNaN(stamp.getTime()))return null;
      return {id: match[2], author: match[1], text: raw.text.trim().slice(0, 10000),
        url: `https://x.com/${match[1]}/status/${match[2]}`, created_at: stamp.toISOString(),
        timestamp: Math.floor(stamp.getTime() / 1000), links: (raw.links || []).slice(0, 8), captured_at: now};
    } catch {return null;}
  }
  function mergePosts(existing, incoming, now) {
    const map = new Map(existing.map(p => [p.id, p]));
    let added = 0;
    for (const raw of incoming) {
      const post = hydrate(raw, now);
      if (post && !map.has(post.id)) {map.set(post.id, post);added++;}
    }
    const posts = [...map.values()].filter(p => now - p.timestamp < RETENTION)
      .sort((a, b) => b.timestamp - a.timestamp).slice(0, STORE_LIMIT);
    return {posts, added};
  }
  function analyze(posts, now) {
    now = now || Date.now() / 1000;
    const window = posts.filter(p => now - p.timestamp < 86400);
    const projects = [];
    for (const [topic, regex] of Object.entries(TOPICS)) {
      const group = window.filter(p => regex.test(p.text));
      if (group.length)projects.push(candidate(group, 'topic', topic, 'spider-' + topic, topic[0].toUpperCase() + topic.slice(1) + ' / X narrative', now));
    }
    for (const [kind, extract] of [['ticker', cashtags], ['contract', solanaAddresses]]) {
      const groups = {};
      for (const p of window)for (const key of extract(p.text))(groups[key] ??= []).push(p);
      const ranked = Object.entries(groups).sort((a, b) => {
        const byAuthors = new Set(b[1].map(p => p.author.toLowerCase())).size - new Set(a[1].map(p => p.author.toLowerCase())).size;
        return byAuthors || b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      }).slice(0, MAX_PER_KIND);
      for (const [key, group] of ranked) {
        if (kind === 'ticker')projects.push(candidate(group, kind, key, 'spider-ticker-' + key, `$${key} / X cashtag`, now));
        else projects.push(candidate(group, kind, key, 'spider-ca-' + key, `${key.slice(0, 4)}…${key.slice(-4)} / Solana address`, now));
      }
    }
    for (const [phrase, group] of emergingPhrases(window, now))
      projects.push(candidate(group, 'phrase', phrase, 'spider-phrase-' + digest(phrase), `“${phrase}” / emerging narrative`, now));
    // Strongest leads first, so a limited model allowance is spent on them.
    projects.sort((a, b) => b.score - a.score || b.signals.authors - a.signals.authors || (b.signals.growth || 0) - (a.signals.growth || 0));
    return projects;
  }
  globalThis.GemEngine = {TOPICS, cashtags, isSolanaAddress, solanaAddresses, phrases, emergingPhrases, velocity, candidate, hydrate, mergePosts, analyze, digest, WINDOW_RECENT, RETENTION, STORE_LIMIT};
})();