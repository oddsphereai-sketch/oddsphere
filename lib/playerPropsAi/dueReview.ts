import {PROPS_AI_FINAL_LEAD_MS} from "./schedule";
/** Scheduling hint for the existing sport writer; never claims, sends or creates a job. */
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Sport} from './evidenceContract';
import {etDate,instant} from './evidence';
import {propsAiSiteConfig,PROPS_AI_CONTROL_RELEASE} from './siteConfig';
export async function hasDuePropsAiReview(args:{client:SupabaseClient;sport:Sport;now:string}):Promise<boolean>{
 const config=propsAiSiteConfig();
 if(!config.paid||!config.key)return false;
 instant(args.now);
 const control=await args.client.from('player_props_ai_control').select('release,paid_enabled').eq('singleton',true).single();
 if(control.error)throw new Error('props_ai_due_control_read_failed');
 if(control.data?.paid_enabled!==true||control.data?.release!==PROPS_AI_CONTROL_RELEASE)return false;
 const due=await args.client.from('player_props_ai_reviews').select('job_key').eq('sport',args.sport).eq('game_day',etDate(args.now)).eq('state','pending').lte('due_at',args.now).gt('lock_at',args.now).or(`stage.eq.final,lock_at.gt.${new Date(instant(args.now)+PROPS_AI_FINAL_LEAD_MS).toISOString()}`).limit(1);
 if(due.error)throw new Error('props_ai_due_review_read_failed');
 return (due.data?.length??0)>0;
}
