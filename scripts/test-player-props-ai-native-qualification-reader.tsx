/** New qualification display and exact legacy/medical precedence; no I/O. */
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AiPropReader} from '../app/player-props/components/AiPropReader';
import {PropsAiEvidence} from '../app/player-props/components/PropsAiEvidence';
import {NFL_NATIVE_QUALIFICATION_RELEASE,NFL_NATIVE_TEMPLATE_UNAVAILABLE,propsAiOperationalException,type PropsAiMemberEvidence,type NflNativeQualification} from '../lib/playerPropsAi/publicationContract';
const legacy:PropsAiMemberEvidence={release:'player_props_ai_2026_11_10_r29_identity_and_execution_evidence',lawRelease:'stored-law',gradeRelease:'stored-grade',publicationRelease:'stored-reader',reviewId:'stored-review',lawHash:'stored-law-hash',inputHash:'stored-input-hash',reviewedAt:'2026-11-10T21:00:00Z',stage:'early',model:'stored-model',confidence:2,confidenceMeaning:'AI-estimated evidence strength; not empirical calibration',quoteConfirmedAt:'2026-11-10T21:00:00Z',selectedSide:'over',assessment:'Stored original assessment.',coverage:{},exception:null};
const qualification:NflNativeQualification={release:NFL_NATIVE_QUALIFICATION_RELEASE,reason:'native_player_context_unavailable' as const,detail:NFL_NATIVE_TEMPLATE_UNAVAILABLE,gameId:'game',playerId:'nfl-bdl-player:666',scheduledStart:'2026-11-10T23:00:00Z',lockAt:'2026-11-10T22:00:00Z',sourcePacketHash:'source',nativeBaselineHash:'baseline'};
const qualified={...legacy,release:'player_props_ai_2026_11_10_r31_verified_reader_claims',nativeQualification:qualification};
const render=(evidence:PropsAiMemberEvidence)=>[
 renderToStaticMarkup(<PropsAiEvidence evidence={evidence}/>),
 renderToStaticMarkup(<AiPropReader evidence={evidence} title="Synthetic" selection="Over 6.5 receptions" projection={7} probability={.7} price="-110" grade="No Play" lockedAt="2026-11-10T22:00:00Z" onClose={()=>{}}/>),
];
const before=JSON.stringify(legacy),original=render(legacy);
assert.equal(propsAiOperationalException(legacy),null);assert(original.every(markup=>!markup.includes('Action qualification unavailable')));
assert(render(qualified).every(markup=>markup.includes(NFL_NATIVE_TEMPLATE_UNAVAILABLE)));
const medical={...qualified,exception:'Source participation unavailable: explicit_out'};
assert.equal(propsAiOperationalException(medical),medical.exception);assert(render(medical).every(markup=>markup.includes(medical.exception)&&!markup.includes(NFL_NATIVE_TEMPLATE_UNAVAILABLE)));
const oldException={...legacy,exception:'Original stored unsupported forecast text.'};assert(render(oldException).every(markup=>markup.includes(oldException.exception)));
const unknown={...qualified,nativeQualification:{...qualification,release:'unknown'} as never};assert.deepEqual(render(unknown),original);
assert.deepEqual(render(legacy),original);assert.equal(JSON.stringify(legacy),before,'Stored legacy law, probabilities, assessment and evidence remain exact');
console.log('Native qualification reader passed: explicit future reason, both familiar readers, stored medical/forecast exception precedence, unknown contract refusal and exact legacy rendering. No I/O.');
