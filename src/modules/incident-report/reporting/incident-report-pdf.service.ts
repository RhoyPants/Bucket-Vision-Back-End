import puppeteer from "puppeteer";
import prisma from "../../../config/prisma";
import { incidentReportService } from "../incident-report.service";

const esc=(v:any)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const date=(v:any)=>v?new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";
export class IncidentReportPdfService {
  async generate(id:string,userId:string){
    await incidentReportService.getById(id,userId);
    const i=await (prisma as any).incidentReport.findUnique({where:{id},include:{project:true,reportedBy:true,incidentType:true,investigation:true,attachments:{orderBy:[{section:"asc"},{displayOrder:"asc"}]},actions:{include:{owner:true,evidence:true}},resolutionConfirmations:{include:{resolver:true},orderBy:{createdAt:"asc"}}}});
    const section=(title:string,value:any)=>`<section><h2>${esc(title)}</h2><p>${esc(value)||"—"}</p></section>`;
    const evidence=(i.attachments||[]).map((a:any)=>`<li>${esc(a.section)} — ${esc(a.caption||a.fileName)}</li>`).join("");
    const actions=(i.actions||[]).map((a:any)=>`<tr><td>${esc(a.actionType)}</td><td>${esc(a.title)}</td><td>${esc(a.owner?.name)}</td><td>${esc(a.status)}</td><td>${esc(String(a.dueDate).slice(0,10))}</td></tr>`).join("");
    const confirmations=(i.resolutionConfirmations||[]).map((r:any)=>`<section><h3>${esc(r.resolver?.name)} — ${esc(r.classification)}</h3><p>${esc(r.remarks)}</p><small>${date(r.createdAt)}</small></section>`).join("");
    const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font:12px Arial;color:#172033;margin:28px}header{border-bottom:3px solid #17365d;margin-bottom:20px}h1{margin-bottom:4px}h2{color:#17365d;border-bottom:1px solid #ccd5df;padding-bottom:4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd5df;padding:7px;text-align:left}.badge{padding:4px 8px;background:${i.status==="RESOLVED"?"#d1fae5":"#fef3c7"}}</style></head><body><header><h1>VISION Incident Report</h1><p>${esc(i.incidentNumber)} · <span class="badge">${i.status==="RESOLVED"?"RESOLVED":"DRAFT / "+i.status}</span></p></header><table><tr><th>Project</th><td>${esc(i.project?.name)}</td><th>Reporter</th><td>${esc(i.reportedBy?.name)}</td></tr><tr><th>Incident Type</th><td>${esc(i.incidentType?.name)}</td><th>Criticality</th><td>${esc(i.severity)}</td></tr><tr><th>Occurred</th><td>${date(i.occurredAt)}</td><th>Location</th><td>${esc(i.location)}</td></tr><tr><th>Addressee</th><td>${esc(i.reportRecipient)||"—"}</td><th>Report Date</th><td>${date(new Date())}</td></tr></table>${section("Subject",i.title)}${section("Initial Report",i.description)}${section("Immediate Action",i.immediateActionTaken)}${section("Site Findings",i.investigation?.siteFindings)}${section("Root Cause",i.investigation?.rootCause)}${section("Contributing Factors",i.investigation?.contributingFactors)}${section("Mitigation",i.investigation?.mitigation)}${section("Recommendations",i.investigation?.recommendations)}<h2>Evidence</h2><ul>${evidence||"<li>None</li>"}</ul><h2>Corrective and Preventive Actions</h2><table><tr><th>Type</th><th>Action</th><th>Owner</th><th>Status</th><th>Due</th></tr>${actions||'<tr><td colspan="5">None</td></tr>'}</table><h2>Resolution</h2>${confirmations||"<p>Pending</p>"}</body></html>`;
    const browser=await puppeteer.launch({headless:true,args:process.env.PUPPETEER_NO_SANDBOX==="true"?["--no-sandbox","--disable-setuid-sandbox"]:[],...(process.env.PUPPETEER_EXECUTABLE_PATH?{executablePath:process.env.PUPPETEER_EXECUTABLE_PATH}:{})});
    try{const page=await browser.newPage();await page.setContent(html,{waitUntil:"domcontentloaded"});return Buffer.from(await page.pdf({format:"A4",printBackground:true,margin:{top:"12mm",right:"10mm",bottom:"12mm",left:"10mm"}}));}finally{await browser.close();}
  }
}
export const incidentReportPdfService=new IncidentReportPdfService();
