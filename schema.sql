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
  room text not null references exam.rooms(slug) on delete cascade,
  session text unique,
  email text,
  claimed_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now());

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
  select slug into r from rooms where lower(code)=lower(btrim(coalesce(p_code,''))) and active;
  if r is null then
    select m.slug into r from access_codes c join rooms m on m.slug=c.room
      where lower(c.code)=lower(btrim(coalesce(p_code,''))) and not c.revoked and m.active;
  end if;
  if r is null then raise exception 'Unknown room code'; end if;
  return r;
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
    'activities',coalesce((select jsonb_agg(jsonb_build_object('slug',a.slug,'kind',a.kind,'title',a.title,'subtitle',a.subtitle,'settings',a.settings,
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
  return jsonb_build_object('id',a.id,'activity',a.activity,'set',a.set_id,'state',a.state);
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
declare nm boolean:=coalesce((select value='true' from config where key='lb_names'),false);
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
  return jsonb_build_object('code',c.code,'room',(select title from rooms where slug=c.room),'claimed_at',c.claimed_at);
end $$;

create function exam.import_set(p_act text,p_set text,p_label text,p_body jsonb) returns jsonb
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

revoke all on schema exam from public;
revoke all on all tables in schema exam from public;
revoke execute on all functions in schema exam from public;
grant usage on schema exam to exam_student, exam_teacher;
grant execute on function exam.join_room(text), exam.get_set(text,text,text), exam.start_attempt(text,text,text,text,text),
  exam.save_attempt(uuid,text,text,jsonb), exam.finish_attempt(uuid,text,text,jsonb), exam.my_attempts(text,text),
  exam.my_report(uuid,text,text), exam.leaderboard(text,text,text),
  exam.live_get(text,text), exam.live_post(text,text,text,jsonb), exam.live_events(text,text,bigint),
  exam.claim_code(text,text) to exam_student;
grant execute on all functions in schema exam to exam_teacher;
grant all on all tables in schema exam to exam_teacher;
grant all on all sequences in schema exam to exam_teacher;
