/* Shared extraction utilities; usable from an isolated content script and Node tests. */
(() => {
  function supported(url) {
    try {const u=new URL(url);return u.protocol==='https:' && ['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname) && !/^\/(messages|i\/chat|settings|account|login|compose)(\/|$)/.test(u.pathname);} catch {return false;}
  }
  function normalize(post) {
    try {
      const u=new URL(post.url);
      const m=u.pathname.match(/^\/([\w]{1,30})\/status\/(\d{1,30})$/);
      const date=new Date(post.created_at);
      if(!supported(u.href)||!m||!post.text?.trim()||!Number.isFinite(date.getTime()))return null;
      const links=[...new Set(post.links||[])].filter(link=>{try{const p=new URL(link);return ['http:','https:'].includes(p.protocol)&&!p.username&&!p.password&&!['x.com','twitter.com','t.co','www.x.com','www.twitter.com'].includes(p.hostname);}catch{return false;}}).slice(0,8);
      return {id:m[2],url:`https://x.com/${m[1]}/status/${m[2]}`,text:post.text.trim().slice(0,10000),created_at:date.toISOString(),links};
    }catch{return null;}
  }
  function extract(article) {
    const text=article.querySelector('[data-testid="tweetText"]');
    const stamp=article.querySelector('time');
    // Prefer timestamp permalink: quoted posts can contain additional status links.
    const permalink=stamp?.closest('a[href*="/status/"]');
    if(!text||!stamp||!permalink)return null;
    const links=[...article.querySelectorAll('a[href]')].map(a=>a.href);
    return normalize({url:permalink.href,text:text.innerText||text.textContent,created_at:stamp.getAttribute('datetime'),links});
  }
  globalThis.GemExtract={supported,normalize,extract};
})();
