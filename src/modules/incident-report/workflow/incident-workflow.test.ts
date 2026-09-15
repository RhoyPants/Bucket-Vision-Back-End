import assert from "node:assert/strict";
import test from "node:test";
import { IncidentApiError, slaDeadline, validateLevels } from "./incident-workflow.contract";
const tx:any={role:{findFirst:async()=>({id:"role",name:"BU Head",isActive:true})},user:{findFirst:async()=>null}};
test("all workflow levels require an SLA, including final",async()=>{const levels=await validateLevels([{order:1,assignmentType:"ROLE",roleId:"role",completionRule:"ANY_ONE",slaValue:3,slaUnit:"DAYS",isFinal:true}],tx);assert.equal(levels[0].completionRule,"ANY_ONE");assert.equal(levels[0].slaValue,3);await assert.rejects(()=>validateLevels([{order:1,assignmentType:"ROLE",roleId:"role",completionRule:"ANY_ONE",slaValue:null,slaUnit:null,isFinal:true}],tx),IncidentApiError);});
test("final workflow level has a deadline",()=>{const calendar={sunday:false,monday:true,tuesday:true,wednesday:true,thursday:true,friday:true,saturday:false,includeHolidays:true,holidays:[]};assert.equal(slaDeadline(new Date("2026-09-09T02:00:00Z"),{slaValue:3,slaUnit:"DAYS"},calendar).toISOString(),"2026-09-14T02:00:00.000Z");});
