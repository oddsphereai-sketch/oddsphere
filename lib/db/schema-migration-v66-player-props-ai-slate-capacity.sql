-- Execution capacity only: no new review slots, prices, retries, or spending allowance.
BEGIN;
DO $$
DECLARE body text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.player_props_ai_control WHERE singleton AND paid_enabled) THEN
  RAISE EXCEPTION 'pause_paid_reviews_before_v65';
 END IF;
 body:=pg_get_functiondef('public.player_props_ai_claim(text,text,jsonb,boolean,text)'::regprocedure);
 IF position('player_props_ai_budget_2026_11_08_r4_target_and_emergency' in body)=0 THEN
  RAISE EXCEPTION 'v64_target_and_emergency_contract_required';
 END IF;
 IF position('WHERE state=''running'')>=2' in body)>0 THEN
  body:=replace(body,'WHERE state=''running'')>=2','WHERE state=''running'')>=16');
  EXECUTE body;
 ELSIF position('WHERE state=''running'')>=16' in body)=0 THEN
  RAISE EXCEPTION 'unexpected_review_concurrency_contract';
 END IF;
END $$;
COMMENT ON FUNCTION public.player_props_ai_claim(text,text,jsonb,boolean,text) IS
 'player_props_ai_schedule_2026_11_08_r2_deadline_admission; sixteen funded game claims; unchanged R4 wallet and two slots per game';
COMMIT;
