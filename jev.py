"""JEV is Gem Search's local signal detector, not a third-party service."""
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit
from automation import TOPICS


def normalize_capture(data):
    posts = data.get('posts') if isinstance(data, dict) else None
    if not isinstance(posts,list) or not 1<=len(posts)<=20:
        raise ValueError('Expected 1–20 captured posts')
    result=[]
    for p in posts:
        if not isinstance(p,dict): raise ValueError('Invalid post')
        url=p.get('url','')
        parsed=urlsplit(url)
        match=re.fullmatch(r'/([A-Za-z0-9_]{1,30})/status/(\d{1,30})',parsed.path)
        if parsed.scheme!='https' or parsed.hostname not in ('x.com','twitter.com','www.x.com','www.twitter.com') or not match or parsed.username or parsed.port:
            raise ValueError('Expected an X post permalink')
        text=p.get('text')
        if not isinstance(text,str) or not 1<=len(text)<=10000:raise ValueError('Invalid post text')
        stamp=datetime.fromisoformat(str(p.get('created_at','')).replace('Z','+00:00'))
        if stamp.tzinfo is None or stamp.timestamp()>time.time()+300:raise ValueError('Invalid post time')
        links=p.get('links',[])
        if not isinstance(links,list) or len(links)>8:raise ValueError('Invalid links')
        clean=[]
        for link in links:
            if not isinstance(link,str) or len(link)>2048:continue
            u=urlsplit(link)
            if u.scheme in ('http','https') and u.hostname and not u.username and not u.password and u.port in (None,80,443):
                if u.hostname not in ('x.com','twitter.com','t.co','www.x.com','www.twitter.com'):
                    clean.append(link)
        result.append({'id':match[2],'author':match[1],'text':text,'url':f'https://x.com/{match[1]}/status/{match[2]}',
                       'created_at':stamp.isoformat(),'timestamp':stamp.timestamp(),'links':clean,'captured_at':time.time()})
    return result


class Jev:
    def __init__(self, connect):
        self.connect=connect
        with connect() as con:
            con.executescript('''CREATE TABLE IF NOT EXISTS spider_posts (id TEXT PRIMARY KEY, created REAL, processed INTEGER DEFAULT 0, payload TEXT);
            CREATE TABLE IF NOT EXISTS spider_meta (key TEXT PRIMARY KEY, value TEXT);''')

    def ingest(self,data):
        posts=normalize_capture(data)
        added=0
        with self.connect() as con:
            pending=con.execute('SELECT COUNT(*) FROM spider_posts WHERE processed=0').fetchone()[0]
            if pending+len(posts)>500:raise ValueError('Local queue full; let crawler catch up')
            for p in posts:
                added+=con.execute('INSERT OR IGNORE INTO spider_posts(id,created,payload) VALUES (?,?,?)',(p['id'],p['timestamp'],json.dumps(p))).rowcount
            con.execute("INSERT OR REPLACE INTO spider_meta VALUES ('last_capture',?)",(str(time.time()),))
            con.execute('DELETE FROM spider_posts WHERE created<? AND processed=1',(time.time()-7*86400,))
        return {'accepted':added,'duplicates':len(posts)-added}

    def status(self):
        with self.connect() as con:
            total=con.execute('SELECT COUNT(*) FROM spider_posts').fetchone()[0]
            pending=con.execute('SELECT COUNT(*) FROM spider_posts WHERE processed=0').fetchone()[0]
            stamp=con.execute("SELECT value FROM spider_meta WHERE key='last_capture'").fetchone()
        return {'captured':total,'pending':pending,'last_capture':float(stamp[0]) if stamp else None}

    def pending(self):
        with self.connect() as con:
            return [json.loads(r['payload']) for r in con.execute('SELECT payload FROM spider_posts WHERE processed=0 ORDER BY created LIMIT 20')]

    def ack(self,posts):
        with self.connect() as con:
            con.executemany('UPDATE spider_posts SET processed=1 WHERE id=?',[(p['id'],) for p in posts])

    def narratives(self):
        with self.connect() as con:
            posts=[json.loads(r['payload']) for r in con.execute('SELECT payload FROM spider_posts WHERE created>? ORDER BY created DESC LIMIT 500',(time.time()-86400,))]
        projects=[]
        for topic,regex in TOPICS.items():
            group=[p for p in posts if re.search(regex,p['text'],re.I)]
            if not group:continue
            authors={p['author'].lower() for p in group}
            # Remove URLs and normalize punctuation to detect repeated promotional text.
            texts={re.sub(r'https?://\S+|[^\w\s]','',p['text'].lower()).strip() for p in group}
            duplicate=1-len(texts)/len(group)
            risks=any(re.search(r'seed phrase|private key|guaranteed profit|connect wallet to claim',p['text'],re.I) for p in group)
            checks=[('lookout',len(authors)>=4,f'{len(authors)} distinct visible authors. This is a sample of the open tab, not the whole X feed.'),
                    ('maker',any(p['links'] for p in group),'External project links observed; inspect crawler evidence for product claims.'),
                    ('skeptic',duplicate<=.35 and not risks,f'{duplicate:.0%} repeated text. Account authenticity is unverified.'),
                    ('runner',len(group)>=5,f'{len(group)} captured posts within 24h; enough for a research lead, not an investment decision.')]
            votes=[{'seat':s,'vote':'reject' if s=='skeptic' and risks else 'pass' if ok else 'hold','reason':reason} for s,ok,reason in checks]
            status='rejected' if risks else 'shortlisted' if all(c[1] for c in checks) else 'held'
            projects.append({'id':'spider-'+topic,'name':topic.title()+' / X narrative','url':group[0]['url'],'source':'spider','topic':topic,
                             'status':status,'score':sum(c[1] for c in checks)*25,'votes':votes,'observed_at':max(p['timestamp'] for p in group),
                             'updated':datetime.now(timezone.utc).isoformat(),'signals':{'mentions':len(group),'authors':len(authors),'growth':None,'duplicate_ratio':duplicate},
                             'evidence':{'synthetic':False,'errors':[],'pages':[{'url':p['url'],'kind':'captured post','text':p['text'],'fetched_at':p['captured_at']} for p in group[:8]]},
                             'posts':group[:20]})
        return projects
