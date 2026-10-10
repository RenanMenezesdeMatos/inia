alter table agent_runs
  add column case_id uuid references supervision_cases(id);
