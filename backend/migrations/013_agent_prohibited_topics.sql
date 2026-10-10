create table agent_prohibited_topics (
  agent_id uuid not null references agents(id) on delete cascade,
  prohibited_topic_id uuid not null references prohibited_topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, prohibited_topic_id)
);
