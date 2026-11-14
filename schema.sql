create schema if not exists exam;

create table if not exists exam.config(key text primary key, value text);
insert into exam.config values('lb_names','false') on conflict do nothing;

create table if not exists exam.rooms(
  slug text primary key,
  title text not null,
  code text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now());

create table if not exists exam.activities(
  slug text primary key,
  room text not null references exam.rooms(slug) on delete cascade,
  kind text not null default 'exam',
  title text not null,
  subtitle text,
  settings jsonb not null default '{}',
  assign text not null default 'random',
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now());

create table if not exists exam.sets(
  activity text not null references exam.activities(slug) on delete cascade,
  set_id text not null,
  label text,
  active boolean not null default true,
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key(activity,set_id));

create table if not exists exam.qkey(
  qid text, ans text, rationale text, dx jsonb, unit text, sp text, lvl text, max numeric default 1);
alter table exam.qkey add column if not exists activity text;
alter table exam.qkey add column if not exists set_id text;
alter table exam.qkey add column if not exists kind text default 'mcq';
alter table exam.qkey add column if not exists tol numeric;
alter table exam.qkey add column if not exists rubric jsonb;
alter table exam.qkey add column if not exists seq int default 0;

create table if not exists exam.attempts(
  id uuid primary key default gen_random_uuid(), email text not null, name text,
  status text default 'in_progress', started_at timestamptz default now(), finished_at timestamptz,
  state jsonb default '{}', released boolean default false, updated_at timestamptz default now());
alter table exam.attempts add column if not exists activity text;
alter table exam.attempts add column if not exists set_id text;
alter table exam.attempts add column if not exists auto jsonb;
alter table exam.attempts add column if not exists auto_score numeric;
alter table exam.attempts add column if not exists auto_max numeric;

do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='exam' and table_name='attempts' and column_name='mcq_score') then
    update exam.attempts set auto_score=mcq_score where auto_score is null;
    update exam.attempts set auto=mcq where auto is null;
    alter table exam.attempts drop column mcq_score;
    alter table exam.attempts drop column mcq;
  end if;
end $$;

do $$
begin
  if exists(select 1 from exam.qkey where activity is null) and not exists(select 1 from exam.rooms) then
    insert into exam.rooms(slug,title,code)
    values('main','Main room',coalesce((select value from exam.config where key='class_code'),'change-me'));
    insert into exam.activities(slug,room,kind,title,subtitle,settings)
    values('apbio-midterm','main','exam','AP Biology Midterm','Units 0–4 · multiple choice and free response',
      '{"sections":[{"id":"s1","title":"Section I · Multiple choice","minutes":90},{"id":"s2","title":"Section II · Free response","minutes":90}],"tools":{"calc":"both","notes":true,"highlight":true},"proctor":true,"pack":"apbio"}'::jsonb);
  end if;
end $$;

update exam.qkey set activity='apbio-midterm', set_id='1' where activity is null;
update exam.qkey set kind='manual' where kind='mcq' and ans is null;
update exam.attempts set activity='apbio-midterm', set_id='1' where activity is null;

alter table exam.qkey alter column activity set not null;
alter table exam.qkey alter column set_id set not null;
alter table exam.qkey alter column qid set not null;
alter table exam.attempts alter column activity set not null;
alter table exam.attempts alter column set_id set not null;

do $$
begin
  if exists(select 1 from pg_constraint where conrelid='exam.qkey'::regclass and contype='p' and conname='qkey_pkey') then
    alter table exam.qkey drop constraint qkey_pkey;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='exam.qkey'::regclass and contype='p') then
    alter table exam.qkey add primary key(activity,set_id,qid);
  end if;
end $$;

create table if not exists exam.grades(
  attempt_id uuid references exam.attempts(id) on delete cascade,
  q text, score numeric, max numeric, comment text, annot text,
  primary key(attempt_id,q));

create table if not exists exam.live(
  activity text primary key references exam.activities(slug) on delete cascade,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now());

create table if not exists exam.live_events(
  id bigserial primary key,
  activity text not null references exam.activities(slug) on delete cascade,
  at timestamptz not null default now(),
  name text,
  msg jsonb not null);

create table if not exists exam.access_codes(
  code text primary key,
  session text unique,
  email text,
  claimed_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now());

alter table exam.access_codes drop column if exists room;
alter table exam.rooms add column if not exists owner text;
alter table exam.activities add column if not exists library boolean not null default false;
alter table exam.activities add column if not exists source text;
insert into exam.rooms(slug,title,code,active) values('library','Exam library','library-'||md5(random()::text),false) on conflict(slug) do nothing;
create index if not exists rooms_owner on exam.rooms(owner);
create index if not exists acts_source on exam.activities(source);
alter table exam.rooms add column if not exists settings jsonb not null default '{}';
alter table exam.rooms add column if not exists share_code text;
create unique index if not exists rooms_share on exam.rooms(lower(share_code)) where share_code is not null;
alter table exam.access_codes add column if not exists mailed_at timestamptz;
update exam.rooms set active=true where slug<>'library' and not active;

create index if not exists attempts_email on exam.attempts(email);
create index if not exists attempts_act on exam.attempts(activity,set_id);
create index if not exists events_act on exam.live_events(activity,id);

do $$
declare r record;
begin
  for r in select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace='exam'::regnamespace loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

create function exam.chk(p_code text) returns text
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r text;
begin
  select m.slug into r from rooms m where lower(m.code)=lower(btrim(coalesce(p_code,''))) and m.slug<>'library'
    and (m.owner is null or exists(select 1 from access_codes c where c.code=m.owner and not c.revoked));
  if r is null then raise exception 'Unknown room code'; end if;
  return r;
end $$;

create function exam.win_msg(s jsonb) returns text
language sql stable set search_path=exam,pg_temp as $$
  select case
    when nullif(s->>'open_at','') is not null and now()<(s->>'open_at')::timestamptz then 'This is not open yet'
    when nullif(s->>'close_at','') is not null and now()>=(s->>'close_at')::timestamptz then 'This has closed'
  end $$;

create function exam.act_ok(p_code text, p_act text) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
begin
  if not exists(select 1 from activities where slug=p_act and room=chk(p_code) and active) then
    raise exception 'Not available in this room';
  end if;
end $$;

create function exam.join_room(p_code text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r rooms;
begin
  select * into r from rooms where slug=chk(p_code);
  return jsonb_build_object('room',jsonb_build_object('slug',r.slug,'title',r.title),
    'activities',coalesce((select jsonb_agg(jsonb_build_object('slug',a.slug,'kind',a.kind,'title',a.title,'subtitle',a.subtitle,'settings',a.settings,'open',win_msg(a.settings) is null,
      'sets',(select coalesce(jsonb_agg(jsonb_build_object('set_id',s.set_id,'label',s.label) order by s.set_id),'[]'::jsonb) from sets s where s.activity=a.slug and s.active))
      order by a.position,a.created_at) from activities a where a.room=r.slug and a.active),'[]'::jsonb));
end $$;

create function exam.get_set(p_code text, p_act text, p_set text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
begin
  perform act_ok(p_code,p_act);
  return (select jsonb_build_object('activity',jsonb_build_object('slug',a.slug,'kind',a.kind,'title',a.title,'subtitle',a.subtitle,'settings',a.settings),
    'set',jsonb_build_object('set_id',s.set_id,'label',s.label,'body',s.body))
    from activities a join sets s on s.activity=a.slug where a.slug=p_act and s.set_id=p_set);
end $$;

create function exam.start_attempt(p_email text,p_name text,p_code text,p_act text,p_set text default null) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a attempts; e text:=lower(trim(p_email)); ac activities; sid text;
begin
  perform act_ok(p_code,p_act);
  select * into ac from activities where slug=p_act;
  select * into a from attempts where email=e and activity=p_act and status='in_progress' order by started_at desc limit 1;
  if not found then
    if win_msg(ac.settings) is not null then raise exception '%', win_msg(ac.settings); end if;
    if p_set is not null and exists(select 1 from sets where activity=p_act and set_id=p_set and active) then
      sid:=p_set;
    elsif ac.assign='rotate' then
      select s.set_id into sid from sets s where s.activity=p_act and s.active
        order by (select count(*) from attempts t where t.activity=p_act and t.set_id=s.set_id), random() limit 1;
    else
      select s.set_id into sid from sets s where s.activity=p_act and s.active order by random() limit 1;
    end if;
    if sid is null then raise exception 'No question set is available'; end if;
    insert into attempts(email,name,activity,set_id) values(e,p_name,p_act,sid) returning * into a;
  end if;
  return jsonb_build_object('id',a.id,'activity',a.activity,'set',a.set_id,'state',a.state,
    'mult',coalesce((select (r.settings->'extra'->>e)::numeric from rooms r where r.slug=ac.room),1));
end $$;

create function exam.save_attempt(p_id uuid,p_email text,p_code text,p_state jsonb) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
begin
  perform chk(p_code);
  update attempts set state=p_state,updated_at=now()
  where id=p_id and email=lower(trim(p_email)) and status='in_progress'
    and activity in (select slug from activities where room=chk(p_code));
end $$;

create function exam.finish_attempt(p_id uuid,p_email text,p_code text,p_state jsonb) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a attempts; res jsonb:='{}'::jsonb; sc numeric:=0; mx numeric:=0; k record; given text; ok boolean;
begin
  perform chk(p_code);
  select * into a from attempts where id=p_id and email=lower(trim(p_email)) and status='in_progress'
    and activity in (select slug from activities where room=chk(p_code));
  if not found then raise exception 'Attempt is not open'; end if;
  for k in select * from qkey where activity=a.activity and set_id=a.set_id and kind<>'manual' and ans is not null loop
    given:=p_state->'ans'->>k.qid;
    ok:=false;
    if given is not null and btrim(given)<>'' then
      if k.kind='mcq' then
        ok:=given ~ '^[0-9]+$' and chr(65+given::int)=k.ans;
        given:=case when given ~ '^[0-9]+$' then chr(65+given::int) else given end;
      elsif k.kind='num' then
        ok:=btrim(given) ~ '^-?[0-9]*\.?[0-9]+(e-?[0-9]+)?$' and abs(btrim(given)::numeric-k.ans::numeric)<=coalesce(k.tol,0);
      else
        ok:=lower(btrim(given))=any(select lower(btrim(x)) from unnest(string_to_array(k.ans,'|')) x);
      end if;
    end if;
    mx:=mx+coalesce(k.max,1);
    if ok then sc:=sc+coalesce(k.max,1); end if;
    res:=res||jsonb_build_object(k.qid,jsonb_build_object('c',given,'ok',ok));
  end loop;
  update attempts set state=p_state,status='finished',finished_at=now(),updated_at=now(),auto=res,auto_score=sc,auto_max=mx where id=p_id;
  return jsonb_build_object('auto_score',sc,'auto_max',mx);
end $$;

create function exam.my_attempts(p_email text,p_code text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare rm text:=chk(p_code);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'activity',a.activity,'title',x.title,
    'set',a.set_id,'status',a.status,'started_at',a.started_at,'finished_at',a.finished_at,'auto_score',a.auto_score,'auto_max',a.auto_max,'released',a.released,
    'manual_score',case when a.released then (select coalesce(sum(score),0) from grades g where g.attempt_id=a.id) end,
    'manual_max',case when a.released then (select coalesce(sum(max),0) from grades g where g.attempt_id=a.id) end) order by a.started_at desc)
    from attempts a join activities x on x.slug=a.activity where x.room=rm and a.email=lower(trim(p_email))),'[]'::jsonb);
end $$;

create function exam.my_report(p_id uuid,p_email text,p_code text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a attempts;
begin
  select t.* into a from attempts t join activities x on x.slug=t.activity
    where t.id=p_id and t.email=lower(trim(p_email)) and x.room=chk(p_code);
  if not found then raise exception 'Attempt not found'; end if;
  if a.status<>'finished' then raise exception 'Report is available after you submit'; end if;
  return jsonb_build_object('attempt',to_jsonb(a)-'state'-'auto','auto',a.auto,'state',a.state,
    'keys',(select coalesce(jsonb_agg(to_jsonb(k)-'activity'-'set_id'),'[]'::jsonb) from qkey k where k.activity=a.activity and k.set_id=a.set_id and (a.released or k.kind<>'manual')),
    'grades',case when a.released then (select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) from grades g where g.attempt_id=a.id) else '[]'::jsonb end);
end $$;

create function exam.leaderboard(p_email text,p_code text,p_act text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare nm boolean:=coalesce((select (r.settings->>'lb_names')::boolean from rooms r join activities a on a.room=r.slug where a.slug=p_act),
  (select value='true' from config where key='lb_names'),false);
begin
  perform act_ok(p_code,p_act);
  return (with t as (select a.email,a.name,coalesce(a.auto_score,0)+case when a.released then (select coalesce(sum(score),0) from grades g where g.attempt_id=a.id) else 0 end as total,coalesce(a.auto_score,0) auto_score
      from attempts a where a.status='finished' and a.activity=p_act),
    b as (select email,max(name) name,max(total) total,max(auto_score) auto,count(*) n from t group by email),
    r as (select rank() over(order by total desc) rk,*,email=lower(trim(p_email)) me from b)
    select jsonb_build_object('n',(select count(*) from b),'avg_auto',(select round(avg(auto),1) from b),
      'rows',coalesce(jsonb_agg(jsonb_build_object('rank',rk,'name',case when nm or me then name else array_to_string(array(select upper(left(w,1)) from regexp_split_to_table(name,'\s+') w),'.')||'.' end,'total',total,'auto',auto,'attempts',n,'me',me) order by rk) filter (where rk<=50 or me),'[]'::jsonb)) from r);
end $$;

create function exam.live_get(p_code text, p_act text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
begin
  perform act_ok(p_code,p_act);
  return coalesce((select jsonb_build_object('state',l.state,'at',extract(epoch from l.updated_at),'now',extract(epoch from clock_timestamp())) from live l where l.activity=p_act),
    jsonb_build_object('state','{}'::jsonb,'at',0,'now',extract(epoch from clock_timestamp())));
end $$;

create function exam.live_post(p_code text, p_act text, p_name text, p_msg jsonb) returns bigint
language plpgsql security definer set search_path=exam,pg_temp as $$
declare nid bigint;
begin
  perform act_ok(p_code,p_act);
  if length(p_msg::text)>2000 then raise exception 'Message too long'; end if;
  insert into live_events(activity,name,msg) values(p_act,left(coalesce(p_name,''),60),p_msg) returning id into nid;
  delete from live_events where activity=p_act and id<nid-500;
  return nid;
end $$;

create function exam.live_events(p_code text, p_act text, p_since bigint default 0) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
begin
  perform act_ok(p_code,p_act);
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'at',extract(epoch from e.at),'name',e.name,'msg',e.msg) order by e.id)
    from (select * from live_events where activity=p_act and id>p_since order by id desc limit 100) e),'[]'::jsonb);
end $$;

create function exam.claim_code(p_session text, p_email text default null) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare c access_codes; s text:=btrim(coalesce(p_session,''));
begin
  if s !~ '^(pay_[A-Za-z0-9]{10,30}|cs_(test|live)_[A-Za-z0-9]{20,240})$' then raise exception 'That is not a valid payment ID. It starts with pay_ and is in your Razorpay receipt.'; end if;
  select * into c from access_codes where session=s;
  if not found then
    update access_codes set session=s, email=nullif(lower(btrim(coalesce(p_email,''))),''), claimed_at=now()
      where code=(select code from access_codes where session is null and not revoked order by created_at, code limit 1 for update skip locked)
      returning * into c;
    if not found then raise exception 'No access codes are left. Contact the seller with your receipt.'; end if;
  end if;
  if c.revoked then raise exception 'This access code was revoked. Contact the seller.'; end if;
  return jsonb_build_object('code',c.code,'claimed_at',c.claimed_at);
end $$;

create function exam.put_set(p_act text,p_set text,p_label text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare c jsonb; s jsonb; n int:=0; i int:=0; pub jsonb;
begin
  if not exists(select 1 from activities where slug=p_act) then raise exception 'Unknown activity %',p_act; end if;
  if jsonb_path_exists(p_body,'$.cards[*].key') or jsonb_path_exists(p_body,'$.cards[*].subs[*].key') then
    delete from qkey where activity=p_act and set_id=p_set;
  end if;
  for c in select * from jsonb_array_elements(p_body->'cards') loop
    i:=i+1;
    if c ? 'key' then
      insert into qkey(activity,set_id,qid,kind,ans,tol,rationale,dx,unit,sp,lvl,max,rubric,seq)
      values(p_act,p_set,c->>'id',coalesce(c->'key'->>'kind','mcq'),c->'key'->>'ans',nullif(c->'key'->>'tol','')::numeric,c->'key'->>'rationale',c->'key'->'dx',
        c->'key'->>'unit',c->'key'->>'sp',c->'key'->>'lvl',coalesce(nullif(c->'key'->>'max','')::numeric,1),c->'key'->'rubric',i*100);
      n:=n+1;
    end if;
    for s in select * from jsonb_array_elements(coalesce(c->'subs','[]'::jsonb)) loop
      i:=i+1;
      if s ? 'key' then
        insert into qkey(activity,set_id,qid,kind,ans,tol,rationale,dx,unit,sp,lvl,max,rubric,seq)
        values(p_act,p_set,(c->>'id')||'.'||(s->>'k'),coalesce(s->'key'->>'kind','manual'),s->'key'->>'ans',nullif(s->'key'->>'tol','')::numeric,s->'key'->>'rationale',s->'key'->'dx',
          s->'key'->>'unit',s->'key'->>'sp',s->'key'->>'lvl',coalesce(nullif(s->'key'->>'max','')::numeric,1),s->'key'->'rubric',i*100);
        n:=n+1;
      end if;
    end loop;
  end loop;
  pub:=jsonb_set(p_body,'{cards}',coalesce((select jsonb_agg(
      (card-'key') || case when card ? 'subs' then jsonb_build_object('subs',(select coalesce(jsonb_agg(sub-'key' order by o),'[]'::jsonb) from jsonb_array_elements(card->'subs') with ordinality x(sub,o))) else '{}'::jsonb end
      order by ord) from jsonb_array_elements(p_body->'cards') with ordinality y(card,ord)),'[]'::jsonb));
  insert into sets(activity,set_id,label,body) values(p_act,p_set,coalesce(p_label,p_set),pub)
  on conflict(activity,set_id) do update set label=excluded.label,body=excluded.body;
  return jsonb_build_object('keys',n,'cards',jsonb_array_length(pub->'cards'));
end $$;

create function exam.import_set(p_act text,p_set text,p_label text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r jsonb; d text; n int:=0;
begin
  r:=put_set(p_act,p_set,p_label,p_body);
  if (select library from activities where slug=p_act) then
    for d in select slug from activities where source=p_act loop
      perform put_set(d,p_set,p_label,p_body); n:=n+1;
    end loop;
  end if;
  return r||jsonb_build_object('copies',n);
end $$;

create function exam.who(p_key text) returns text
language plpgsql security definer set search_path=exam,pg_temp as $$
declare c text;
begin
  if session_user='exam_teacher' then return '*'; end if;
  select code into c from access_codes where upper(code)=upper(btrim(coalesce(p_key,''))) and not revoked;
  if c is null then raise exception 'Unknown or revoked teacher access code'; end if;
  return c;
end $$;

create function exam.own_room(p_key text, p_room text) returns exam.rooms
language plpgsql security definer set search_path=exam,pg_temp as $$
declare w text:=who(p_key); r rooms;
begin
  select * into r from rooms where slug=p_room and (w='*' or owner=w);
  if not found then raise exception 'Room not found'; end if;
  return r;
end $$;

create function exam.own_act(p_key text, p_act text) returns exam.activities
language plpgsql security definer set search_path=exam,pg_temp as $$
declare w text:=who(p_key); a activities;
begin
  select x.* into a from activities x join rooms r on r.slug=x.room where x.slug=p_act and (w='*' or r.owner=w);
  if not found then raise exception 'Activity not found'; end if;
  return a;
end $$;

create function exam.own_att(p_key text, p_id uuid) returns exam.attempts
language plpgsql security definer set search_path=exam,pg_temp as $$
declare w text:=who(p_key); t attempts;
begin
  select a.* into t from attempts a join activities x on x.slug=a.activity join rooms r on r.slug=x.room where a.id=p_id and (w='*' or r.owner=w);
  if not found then raise exception 'Attempt not found'; end if;
  return t;
end $$;

create function exam.mkslug(p text) returns text
language sql volatile set search_path=exam,pg_temp as $$
  select coalesce(nullif(trim(both '-' from left(regexp_replace(lower(coalesce(p,'')),'[^a-z0-9]+','-','g'),32)),''),'item')
    ||'-'||substr(md5(random()::text||clock_timestamp()::text),1,6) $$;

create function exam.room_code_ok(p_code text, p_slug text) returns text
language plpgsql security definer set search_path=exam,pg_temp as $$
declare c text:=btrim(coalesce(p_code,''));
begin
  if c !~ '^[A-Za-z0-9][A-Za-z0-9_-]{3,39}$' then raise exception 'Room code must be 4 to 40 letters, digits, - or _'; end if;
  if exists(select 1 from rooms where lower(code)=lower(c) and slug is distinct from p_slug)
     or exists(select 1 from rooms where lower(share_code)=lower(c))
     or exists(select 1 from access_codes where lower(code)=lower(c)) then
    raise exception 'That room code is already used.';
  end if;
  return c;
end $$;

create function exam.copy_act(p_src text, p_room text, p_pos int default null) returns text
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities; n text;
begin
  select * into a from activities where slug=p_src;
  if not found then raise exception 'Activity not found'; end if;
  n:=mkslug(a.title);
  insert into activities(slug,room,kind,title,subtitle,settings,assign,active,position,source)
    values(n,p_room,a.kind,a.title,a.subtitle,a.settings,a.assign,a.library or a.active,coalesce(p_pos,a.position),case when a.library then a.slug else a.source end);
  insert into sets(activity,set_id,label,active,body) select n,set_id,label,active,body from sets where activity=p_src;
  insert into qkey(activity,set_id,qid,kind,ans,tol,rationale,dx,unit,sp,lvl,max,rubric,seq)
    select n,set_id,qid,kind,ans,tol,rationale,dx,unit,sp,lvl,max,rubric,seq from qkey where activity=p_src;
  return n;
end $$;

create function exam.t_login(p_key text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare w text:=who(p_key);
begin
  return jsonb_build_object('admin',w='*','code',case when w<>'*' then w end);
end $$;

create function exam.t_rooms(p_key text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare w text:=who(p_key);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('slug',r.slug,'title',r.title,'code',r.code,'active',r.active,'owner',r.owner,
      'n',(select count(*) from activities a where a.room=r.slug),
      'students',(select count(distinct t.email) from attempts t join activities a on a.slug=t.activity where a.room=r.slug)) order by r.slug='library' desc, r.created_at)
    from rooms r where w='*' or r.owner=w),'[]'::jsonb);
end $$;

create function exam.t_room_create(p_key text, p_title text, p_code text) returns text
language plpgsql security definer set search_path=exam,pg_temp as $$
declare w text:=who(p_key); s text; c text;
begin
  if coalesce(btrim(p_title),'')='' then raise exception 'Give the room a name'; end if;
  if w<>'*' and (select count(*) from rooms where owner=w)>=100 then raise exception 'Room limit reached (100)'; end if;
  c:=room_code_ok(p_code,null); s:=mkslug(p_title);
  insert into rooms(slug,title,code,owner) values(s,left(btrim(p_title),120),c,nullif(w,'*'));
  return s;
end $$;

create function exam.t_room(p_key text, p_room text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r rooms:=own_room(p_key,p_room);
begin
  return jsonb_build_object('room',to_jsonb(r),'activities',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object(
      'nsets',(select count(*) from sets s where s.activity=a.slug),
      'natt',(select count(*) from attempts t where t.activity=a.slug),
      'pending',(select count(*) from attempts t where t.activity=a.slug and t.status='finished' and not t.released)) order by a.position,a.created_at)
    from activities a where a.room=r.slug),'[]'::jsonb));
end $$;

create function exam.t_room_update(p_key text, p_room text, p jsonb) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r rooms:=own_room(p_key,p_room); c text; sc text; ns jsonb;
begin
  if p ? 'code' then c:=room_code_ok(p->>'code',r.slug); end if;
  if p ? 'share_code' then
    sc:=nullif(btrim(coalesce(p->>'share_code','')),'');
    if sc is not null then
      if sc !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,39}$' then raise exception 'Share code must be 8 to 40 letters, digits, - or _'; end if;
      if exists(select 1 from rooms where lower(code)=lower(sc) or (lower(share_code)=lower(sc) and slug<>r.slug))
         or exists(select 1 from access_codes where lower(code)=lower(sc)) then
        raise exception 'That share code is already used.';
      end if;
    end if;
  end if;
  if p ? 'settings' then
    ns:=r.settings||coalesce(p->'settings','{}'::jsonb);
    if ns ? 'extra' then
      if jsonb_typeof(ns->'extra')<>'object' then raise exception 'Extra time must be a list of emails'; end if;
      if exists(select 1 from jsonb_each_text(ns->'extra') x where case when x.value ~ '^[0-9]{1,2}(\.[0-9]{1,3})?$' then x.value::numeric not between 1 and 4 else true end) then
        raise exception 'Extra time must be between 1x and 4x';
      end if;
      ns:=jsonb_set(ns,'{extra}',coalesce((select jsonb_object_agg(lower(btrim(x.key)),x.value::numeric) from jsonb_each_text(ns->'extra') x where btrim(x.key)<>''),'{}'::jsonb));
    end if;
    if ns ? 'lb_names' and jsonb_typeof(ns->'lb_names') not in ('boolean','null') then raise exception 'Unknown leaderboard setting'; end if;
  end if;
  update rooms set title=coalesce(left(nullif(btrim(p->>'title'),''),120),title), code=coalesce(c,code),
    active=case when slug='library' then false else coalesce((p->>'active')::boolean,active) end,
    share_code=case when p ? 'share_code' then sc else share_code end,
    settings=coalesce(ns,settings)
  where slug=r.slug;
end $$;

create function exam.t_room_delete(p_key text, p_room text) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r rooms:=own_room(p_key,p_room);
begin
  if r.slug='library' then raise exception 'The exam library cannot be deleted'; end if;
  delete from rooms where slug=r.slug;
end $$;

create function exam.t_room_copy(p_key text, p_from text, p_title text, p_code text) returns text
language plpgsql security definer set search_path=exam,pg_temp as $$
declare w text:=who(p_key); src rooms; s text; c text; a record;
begin
  select * into src from rooms where slug=p_from and (w='*' or owner=w);
  if not found then
    select * into src from rooms where share_code is not null and lower(share_code)=lower(btrim(coalesce(p_from,''))) and slug<>'library';
  end if;
  if not found then raise exception 'No room has that share code'; end if;
  if w<>'*' and (select count(*) from rooms where owner=w)>=100 then raise exception 'Room limit reached (100)'; end if;
  c:=room_code_ok(p_code,null);
  s:=mkslug(coalesce(nullif(btrim(p_title),''),src.title));
  insert into rooms(slug,title,code,owner) values(s,left(coalesce(nullif(btrim(p_title),''),src.title||' (copy)'),120),c,nullif(w,'*'));
  for a in select slug from activities where room=src.slug order by position,created_at loop
    perform copy_act(a.slug,s);
  end loop;
  return s;
end $$;

create function exam.t_gradebook(p_key text, p_room text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r rooms:=own_room(p_key,p_room);
begin
  return jsonb_build_object(
    'exams',(select coalesce(jsonb_agg(jsonb_build_object('slug',a.slug,'title',a.title) order by a.position,a.created_at),'[]'::jsonb)
      from activities a where a.room=r.slug and a.kind='exam'),
    'rows',(select coalesce(jsonb_agg(q.x),'[]'::jsonb) from (
      select distinct on (t.email,t.activity) jsonb_build_object('email',t.email,'name',t.name,'activity',t.activity,
        'auto',coalesce(t.auto_score,0),'auto_max',coalesce(t.auto_max,0),
        'manual',(select coalesce(sum(g.score),0) from grades g where g.attempt_id=t.id),
        'manual_max',(select coalesce(sum(k.max),0) from qkey k where k.activity=t.activity and k.set_id=t.set_id and k.kind='manual'),
        'marked',(select count(*) from grades g where g.attempt_id=t.id)>=(select count(*) from qkey k where k.activity=t.activity and k.set_id=t.set_id and k.kind='manual'),
        'finished_at',t.finished_at) x
      from attempts t join activities a on a.slug=t.activity
      where a.room=r.slug and t.status='finished'
      order by t.email,t.activity,t.finished_at desc) q));
end $$;

create function exam.t_library(p_key text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
begin
  perform who(p_key);
  return coalesce((select jsonb_agg(jsonb_build_object('slug',a.slug,'title',a.title,'subtitle',a.subtitle,'kind',a.kind,
      'sets',(select count(*) from sets s where s.activity=a.slug and s.active)) order by a.title)
    from activities a where a.library),'[]'::jsonb);
end $$;

create function exam.t_add_library(p_key text, p_room text, p_lib text) returns text
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r rooms:=own_room(p_key,p_room);
begin
  if not exists(select 1 from activities where slug=p_lib and library) then raise exception 'That exam is not in the library'; end if;
  return copy_act(p_lib,r.slug,(select coalesce(max(position),-1)+1 from activities where room=r.slug));
end $$;

create function exam.t_act_create(p_key text, p_room text, p_kind text, p_title text, p_settings jsonb) returns text
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r rooms:=own_room(p_key,p_room); s text;
begin
  if coalesce(p_kind,'') !~ '^[a-z][a-z0-9_-]{0,30}$' then raise exception 'Unknown activity type'; end if;
  s:=mkslug(p_title);
  insert into activities(slug,room,kind,title,settings,position)
    values(s,r.slug,p_kind,left(coalesce(nullif(btrim(p_title),''),p_kind),120),coalesce(p_settings,'{}'::jsonb),(select coalesce(max(position),-1)+1 from activities where room=r.slug));
  return s;
end $$;

create function exam.t_act(p_key text, p_act text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  return to_jsonb(a)||(select jsonb_build_object('room_title',r.title,'room_code',r.code) from rooms r where r.slug=a.room);
end $$;

create function exam.t_act_update(p_key text, p_act text, p jsonb) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  if p ? 'assign' and p->>'assign' not in ('random','rotate') then raise exception 'Unknown assignment mode'; end if;
  update activities set title=coalesce(left(nullif(btrim(p->>'title'),''),120),title),
    subtitle=case when p ? 'subtitle' then nullif(btrim(p->>'subtitle'),'') else subtitle end,
    assign=coalesce(p->>'assign',assign), settings=coalesce(p->'settings',settings), active=coalesce((p->>'active')::boolean,active)
  where slug=a.slug;
end $$;

create function exam.t_act_delete(p_key text, p_act text) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  delete from activities where slug=a.slug;
end $$;

create function exam.t_act_order(p_key text, p_room text, p_slugs jsonb) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare r rooms:=own_room(p_key,p_room);
begin
  for i in 0..coalesce(jsonb_array_length(p_slugs),0)-1 loop
    update activities set position=i where slug=p_slugs->>i and room=r.slug;
  end loop;
end $$;

create function exam.t_sets(p_key text, p_act text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('set_id',s.set_id,'label',s.label,'active',s.active,'created_at',s.created_at,
      'n',jsonb_array_length(s.body->'cards'),
      'keys',(select count(*) from qkey k where k.activity=s.activity and k.set_id=s.set_id),
      'att',(select count(*) from attempts t where t.activity=s.activity and t.set_id=s.set_id)) order by s.set_id)
    from sets s where s.activity=a.slug),'[]'::jsonb);
end $$;

create function exam.t_set_update(p_key text, p_act text, p_set text, p_active boolean) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  update sets set active=p_active where activity=a.slug and set_id=p_set;
end $$;

create function exam.t_set_delete(p_key text, p_act text, p_set text) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  delete from qkey where activity=a.slug and set_id=p_set;
  delete from sets where activity=a.slug and set_id=p_set;
end $$;

create function exam.t_set_get(p_key text, p_act text, p_set text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  return (select jsonb_build_object('label',s.label,'body',s.body,
      'keys',(select coalesce(jsonb_agg(to_jsonb(k)),'[]'::jsonb) from qkey k where k.activity=s.activity and k.set_id=s.set_id))
    from sets s where s.activity=a.slug and s.set_id=p_set);
end $$;

create function exam.t_import_set(p_key text, p_act text, p_set text, p_label text, p_body jsonb) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  if coalesce(btrim(p_set),'') !~ '^[A-Za-z0-9_-]{1,20}$' then raise exception 'Set id must be 1 to 20 letters, digits, - or _'; end if;
  return import_set(a.slug,btrim(p_set),p_label,p_body);
end $$;

create function exam.t_attempts(p_key text, p_act text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'email',t.email,'name',t.name,'set_id',t.set_id,'status',t.status,
      'started_at',t.started_at,'finished_at',t.finished_at,'auto_score',t.auto_score,'auto_max',t.auto_max,'released',t.released,
      'graded',(select count(*) from grades g where g.attempt_id=t.id),
      'manual',(select coalesce(sum(score),0) from grades g where g.attempt_id=t.id),
      'to_grade',(select count(*) from qkey k where k.activity=t.activity and k.set_id=t.set_id and k.kind='manual'),
      'leaves',(select count(*) from jsonb_array_elements(coalesce(t.state->'ev','[]'::jsonb)) e where e->>1 = any(array['blur','hidden','fs-exit'])))
      order by t.started_at desc)
    from attempts t where t.activity=a.slug),'[]'::jsonb);
end $$;

create function exam.t_release_marked(p_key text, p_act text) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  update attempts t set released=true where t.activity=a.slug and t.status='finished'
    and (select count(*) from grades g where g.attempt_id=t.id) >= (select count(*) from qkey k where k.activity=t.activity and k.set_id=t.set_id and k.kind='manual');
end $$;

create function exam.t_summary(p_key text, p_act text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  return jsonb_build_object(
    'atts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'set_id',set_id,'auto',auto,'auto_score',auto_score,'auto_max',auto_max,'t',state->'t')),'[]'::jsonb)
      from attempts where activity=a.slug and status='finished'),
    'keys',(select coalesce(jsonb_agg(jsonb_build_object('qid',qid,'set_id',set_id,'kind',kind,'ans',ans,'unit',unit,'max',max) order by set_id,seq,qid),'[]'::jsonb)
      from qkey where activity=a.slug),
    'grades',(select coalesce(jsonb_agg(jsonb_build_object('q',g.q,'score',g.score,'max',g.max,'set_id',t.set_id)),'[]'::jsonb)
      from grades g join attempts t on t.id=g.attempt_id where t.activity=a.slug));
end $$;

create function exam.t_attempt(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare t attempts:=own_att(p_key,p_id);
begin
  return jsonb_build_object(
    't',(select to_jsonb(t)||jsonb_build_object('title',a.title,'settings',a.settings,'room',a.room,'room_title',r.title)
      from activities a join rooms r on r.slug=a.room where a.slug=t.activity),
    'set',(select jsonb_build_object('label',label,'body',body) from sets where activity=t.activity and set_id=t.set_id),
    'keys',(select coalesce(jsonb_agg(to_jsonb(k)),'[]'::jsonb) from qkey k where k.activity=t.activity and k.set_id=t.set_id),
    'grades',(select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) from grades g where g.attempt_id=t.id));
end $$;

create function exam.t_attempt_release(p_key text, p_id uuid, p_released boolean) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare t attempts:=own_att(p_key,p_id);
begin
  update attempts set released=p_released where id=t.id;
end $$;

create function exam.t_grade(p_key text, p_id uuid, p_q text, p_score numeric, p_max numeric, p_comment text) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare t attempts:=own_att(p_key,p_id);
begin
  insert into grades(attempt_id,q,score,max,comment) values(t.id,p_q,p_score,p_max,left(p_comment,5000))
  on conflict(attempt_id,q) do update set score=excluded.score,max=excluded.max,comment=excluded.comment;
end $$;

create function exam.t_live_put(p_key text, p_act text, p_state jsonb) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  insert into live(activity,state,updated_at) values(a.slug,p_state,now())
  on conflict(activity) do update set state=excluded.state, updated_at=now();
end $$;

create function exam.t_live_get(p_key text, p_act text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  return coalesce((select jsonb_build_object('state',l.state,'at',extract(epoch from l.updated_at),'now',extract(epoch from clock_timestamp())) from live l where l.activity=a.slug),
    jsonb_build_object('state','{}'::jsonb,'at',0,'now',extract(epoch from clock_timestamp())));
end $$;

create function exam.t_live_events(p_key text, p_act text, p_since bigint) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'at',extract(epoch from e.at),'name',e.name,'msg',e.msg) order by e.id)
    from (select * from live_events where activity=a.slug and id>coalesce(p_since,0) order by id desc limit 200) e),'[]'::jsonb);
end $$;

create function exam.t_live_post(p_key text, p_act text, p_msg jsonb) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
declare a activities:=own_act(p_key,p_act);
begin
  insert into live_events(activity,name,msg) values(a.slug,'Teacher',p_msg);
end $$;

create function exam.t_config(p_key text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
begin
  if who(p_key)<>'*' then raise exception 'Only the site owner can change this'; end if;
  return coalesce((select jsonb_object_agg(key,value) from config),'{}'::jsonb);
end $$;

create function exam.t_config_set(p_key text, p_name text, p_value text) returns void
language plpgsql security definer set search_path=exam,pg_temp as $$
begin
  if who(p_key)<>'*' then raise exception 'Only the site owner can change this'; end if;
  insert into config values(p_name,p_value) on conflict(key) do update set value=excluded.value;
end $$;

create function exam.t_backup(p_key text) returns jsonb
language plpgsql security definer set search_path=exam,pg_temp as $$
declare w text:=who(p_key); rs text[];
begin
  rs:=array(select slug from rooms where w='*' or owner=w);
  return jsonb_build_object(
    'rooms',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from rooms r where slug=any(rs)),
    'activities',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from activities a where room=any(rs)),
    'sets',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from sets s join activities a on a.slug=s.activity where a.room=any(rs)),
    'qkey',(select coalesce(jsonb_agg(to_jsonb(k)),'[]'::jsonb) from qkey k join activities a on a.slug=k.activity where a.room=any(rs)),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from attempts t join activities a on a.slug=t.activity where a.room=any(rs)),
    'grades',(select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) from grades g join attempts t on t.id=g.attempt_id join activities a on a.slug=t.activity where a.room=any(rs)));
end $$;

revoke all on schema exam from public;
revoke all on all tables in schema exam from public;
revoke execute on all functions in schema exam from public;
grant usage on schema exam to exam_student, exam_teacher;
grant execute on function exam.join_room(text), exam.get_set(text,text,text), exam.start_attempt(text,text,text,text,text),
  exam.save_attempt(uuid,text,text,jsonb), exam.finish_attempt(uuid,text,text,jsonb), exam.my_attempts(text,text),
  exam.my_report(uuid,text,text), exam.leaderboard(text,text,text),
  exam.live_get(text,text), exam.live_post(text,text,text,jsonb), exam.live_events(text,text,bigint),
  exam.claim_code(text,text) to exam_student;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace='exam'::regnamespace and p.proname like 't\_%' loop
    execute 'grant execute on function ' || r.sig || ' to exam_student';
  end loop;
end $$;
grant execute on all functions in schema exam to exam_teacher;
grant all on all tables in schema exam to exam_teacher;
grant all on all sequences in schema exam to exam_teacher;
