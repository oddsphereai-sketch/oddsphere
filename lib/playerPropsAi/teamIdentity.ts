/** Shared source/calendar team aliases; unchanged source identity semantics. */
export const propsTeam=(s:string)=>({WSH:"WAS",JAC:"JAX",LA:"LAR",GS:"GSW",NY:"NYK",SA:"SAS",NO:"NOP",UTAH:"UTA",CHW:"CWS",AZ:"ARI",ATH:"OAK"}[s.toUpperCase()]??s.toUpperCase());
