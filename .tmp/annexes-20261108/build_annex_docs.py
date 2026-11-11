from copy import deepcopy
from pathlib import Path
import hashlib
import re
import zipfile
from lxml import etree

REFERENCE = Path(r"C:\Users\verga\Downloads\REPRINT FINAL REQ\Informed Consent v2 - READY TO PRINT.docx")
OUTPUT_DIR = Path(r"C:\Users\verga\Downloads\REPRINT FINAL REQ\output here")
EXPECTED_SHA = "bf3999bf56204a6b7142a3dd84e18e6d99a52ce0e8cc77a0155985b0cca09904"
STUDY_TITLE = (
    "Architecting a Lightweight Cloud-Based Inventory and Financial Management System: "
    "A Mixed-Methods Evaluation of Decision-Making Efficiency in Philippine SMEs"
)
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "xml": "http://www.w3.org/XML/1998/namespace",
}
W = "{" + NS["w"] + "}"
R = "{" + NS["r"] + "}"
REL = "{" + NS["rel"] + "}"
XML_SPACE = "{" + NS["xml"] + "}space"
ET = etree


def q(tag):
    return W + tag


def verify_reference():
    actual = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()
    if actual != EXPECTED_SHA:
        raise RuntimeError(f"Reference changed; expected {EXPECTED_SHA}, found {actual}")


with zipfile.ZipFile(REFERENCE, "r") as zf:
    BASE_PARTS = {item.filename: zf.read(item.filename) for item in zf.infolist()}
    BASE_INFOS = {item.filename: item for item in zf.infolist()}

doc_root = ET.fromstring(BASE_PARTS["word/document.xml"])
body = doc_root.find(q("body"))
source_paragraphs = [child for child in body if child.tag == q("p")]


def first_rpr(paragraph):
    found = paragraph.find(".//" + q("rPr"))
    return deepcopy(found) if found is not None else None


TEMPLATES = {
    "blank": source_paragraphs[3],
    "start_blank": source_paragraphs[0],
    "title": source_paragraphs[1],
    "salutation": source_paragraphs[2],
    "intro": source_paragraphs[4],
    "body": source_paragraphs[7],
    "heading": source_paragraphs[6],
    "rule": source_paragraphs[20],
    "consent_heading": source_paragraphs[21],
    "consent_body": source_paragraphs[22],
    "contact": source_paragraphs[16],
    "signature": source_paragraphs[24],
}
TEMPLATE_RPR = {key: first_rpr(value) for key, value in TEMPLATES.items()}


def new_paragraph(role, text=None, page_break_before=False):
    p = deepcopy(TEMPLATES[role])
    ppr = p.find(q("pPr"))
    for child in list(p):
        if child is not ppr:
            p.remove(child)
    if text is not None:
        run = ET.Element(q("r"))
        rpr = TEMPLATE_RPR.get(role)
        if rpr is None:
            rpr = TEMPLATE_RPR["body"]
        if rpr is not None:
            run.append(deepcopy(rpr))
        t = ET.SubElement(run, q("t"))
        t.text = text
        if text[:1].isspace() or text[-1:].isspace():
            t.set(XML_SPACE, "preserve")
        p.append(run)
    if page_break_before:
        if ppr is None:
            ppr = ET.Element(q("pPr"))
            p.insert(0, ppr)
        if ppr.find(q("pageBreakBefore")) is None:
            ET.SubElement(ppr, q("pageBreakBefore"))
    return p


def normal(role, text):
    return new_paragraph(role, text)


def hyperlink_paragraph(text, rid):
    p = new_paragraph("body", None)
    hyperlink = ET.SubElement(p, q("hyperlink"))
    hyperlink.set(R + "id", rid)
    run = ET.SubElement(hyperlink, q("r"))
    rpr = ET.SubElement(run, q("rPr"))
    style = ET.SubElement(rpr, q("rStyle"))
    style.set(q("val"), "Hyperlink")
    t = ET.SubElement(run, q("t"))
    t.text = text
    return p


def consent_body(title, items, signature_type="signed"):
    out = [
        new_paragraph("start_blank", None),
        new_paragraph("title", title),
        new_paragraph("salutation", "Dear Participant,"),
        new_paragraph("blank", None),
        normal("intro", "We are student researchers in the Bachelor of Science in Information Technology program at Southwestern University-PHINMA. We are conducting this capstone study:"),
        normal("body", STUDY_TITLE),
        normal("body", "The study examines inventory and financial recordkeeping in Philippine small and medium enterprises and evaluates Kodigo, a cloud-based inventory and financial management system."),
    ]
    for item in items:
        kind = item[0]
        if kind == "heading":
            out.append(normal("heading", item[1]))
        elif kind == "body":
            out.append(normal("body", item[1]))
        elif kind == "blank":
            out.append(new_paragraph("blank", None))
        elif kind == "contact":
            out.append(normal("contact", item[1]))
        elif kind == "recording":
            out.append(normal("body", item[1]))
        elif kind == "rule":
            out.append(new_paragraph("rule", None))
        elif kind == "agreement":
            out.append(new_paragraph("consent_heading", "Agreement"))
            out.append(new_paragraph("consent_body", item[1]))
        elif kind == "signature":
            out.append(new_paragraph("signature", item[1]))
        else:
            raise ValueError(kind)
    return out


INTERVIEW_ITEMS = [
    ("heading", "What taking part involves"),
    ("body", "A researcher will ask 11 guided questions about inventory, sales, and reconciliation. The interview is expected to take about 30 to 45 minutes. You may skip questions and should not share passwords, customer records, or confidential business details."),
    ("heading", "Possible risks and benefits"),
    ("body", "No direct benefit is promised. Talking about work problems may feel sensitive; you may skip questions or stop. Your experience may help describe SME workflows and assess Kodigo."),
    ("heading", "Audio recording"),
    ("body", "We will take written notes. Recording is optional; if you say no, we will use notes only. Your choice does not affect participation."),
    ("recording", "Recording permission: [ ] I agree to audio recording    [ ] I do not agree"),
    ("heading", "Voluntary participation and withdrawal"),
    ("body", "Participation is voluntary. You may decline, skip questions, or stop without penalty or effect on your business or university relationship. To withdraw, contact us before your notes or transcript are de-identified for combined analysis; afterward, we may not be able to identify your answers."),
    ("heading", "Privacy and use of information"),
    ("body", "We will omit your name and business name, use a participant code, and may quote comments without identifying details. The research team and academic adviser alone will access interview notes and transcripts. Signed consent will be stored separately. Audio will be deleted after transcript verification; other records follow university retention requirements."),
    ("heading", "Researcher contacts"),
    ("contact", "Evon Christian Pahugot Vergara  |  evpa.vergara.swu@phinmaed.com  |  09062983517"),
    ("contact", "Justin Commendador  |  just.comendador.swu@phinmaed.com"),
    ("contact", "Xymmer James Nadera  |  xyde.nadera.swu@phinmaed.com"),
    ("rule", ""),
    ("agreement", "I have read this form or had it explained, and my questions were answered. I understand participation is voluntary, I may stop without penalty, and audio recording is optional. I freely agree to take part."),
    ("signature", "Participant name (print): __________________________________________"),
    ("signature", "Participant signature: __________________________________  Date: __________________"),
]

PRESURVEY_ITEMS = [
    ("heading", "Purpose and what you will do"),
    ("body", "You are invited because your work may involve inventory, sales recording, stock counts, reporting, or financial reconciliation. If you agree, you will complete a 25-question pre-survey about your role and current work processes. It should take about 10 to 15 minutes. The questionnaire does not ask for your name, password, or account credentials. You may leave any question unanswered."),
    ("heading", "Possible risks and benefits"),
    ("body", "There is no direct benefit promised. Questions about work practices and errors may feel sensitive. You may skip any question and should not include customer names, passwords, or confidential financial details."),
    ("heading", "Voluntary participation and withdrawal"),
    ("body", "Taking part is voluntary. You may decline or stop before submitting your questionnaire without penalty or effect on your relationship with the university or your business. Because the survey does not collect a name or unique code, the researchers may be unable to locate and remove a response after it has been submitted."),
    ("heading", "Privacy and use of information"),
    ("body", "The signed consent form will be stored separately from the questionnaire. Survey responses will be used for this academic study and reported in summary form without names or business names. The questionnaire asks about your role and work experience; in a small workplace, people familiar with the organization may infer who gave a response from those details. Access to study records will be limited to the research team and academic adviser, and records will be retained and disposed of under university research requirements."),
    ("heading", "Researcher contacts"),
    ("contact", "Evon Christian Pahugot Vergara  |  evpa.vergara.swu@phinmaed.com  |  09062983517"),
    ("contact", "Justin Commendador  |  just.comendador.swu@phinmaed.com"),
    ("contact", "Xymmer James Nadera  |  xyde.nadera.swu@phinmaed.com"),
    ("rule", ""),
    ("agreement", "I have read or had this form explained to me and had a chance to ask questions. I understand that participation is voluntary, that I may skip questions or stop before submitting, and that a submitted response cannot usually be withdrawn because it is not linked to my name. I freely agree to complete the pre-survey."),
    ("signature", "Participant name (print, optional): _________________________________"),
    ("signature", "Participant signature: __________________________________  Date: __________________"),
]

POSTSURVEY_ITEMS = [
    ("heading", "Purpose and what you will do"),
    ("body", "You are invited because you used or evaluated Kodigo during beta testing. If you agree, you will complete a 19-statement post-survey about cost-effectiveness, system reliability, operational efficiency, and security. It should take about 10 to 15 minutes. The questionnaire does not ask for your name, password, or account credentials. You may leave any item unanswered."),
    ("heading", "Possible risks and benefits"),
    ("body", "There is no direct benefit promised. Rating a system used by your business may feel sensitive. You may skip an item. Do not write passwords, customer information, or confidential transaction details on the questionnaire."),
    ("heading", "Voluntary participation and withdrawal"),
    ("body", "Taking part is voluntary. You may decline or stop before submitting your questionnaire without penalty or effect on your relationship with the university or your business. Because the questionnaire does not collect a name or unique code, the researchers may be unable to locate and remove your response after it has been submitted."),
    ("heading", "Privacy and use of information"),
    ("body", "The signed consent form will be stored separately from the questionnaire. The researchers will not include your personal name or login details in the thesis and will report the ratings in summary form. Because this study includes one client post-survey, people familiar with the project may infer who responded even if your name is omitted. Access to records will be limited to the research team and academic adviser; records will be retained and disposed of under university research requirements."),
    ("heading", "Researcher contacts"),
    ("contact", "Evon Christian Pahugot Vergara  |  evpa.vergara.swu@phinmaed.com  |  09062983517"),
    ("contact", "Justin Commendador  |  just.comendador.swu@phinmaed.com"),
    ("contact", "Xymmer James Nadera  |  xyde.nadera.swu@phinmaed.com"),
    ("rule", ""),
    ("agreement", "I have read or had this form explained to me and had a chance to ask questions. I understand that participation is voluntary, that I may skip items or stop before submitting, and that a submitted response cannot usually be withdrawn because it is not linked to my name. I freely agree to complete the post-survey."),
    ("signature", "Participant name (print, optional): _________________________________"),
    ("signature", "Participant signature: __________________________________  Date: __________________"),
]


def font_properties(run, bold=False, color="000000", underline=False):
    rpr = ET.SubElement(run, q("rPr"))
    fonts = ET.SubElement(rpr, q("rFonts"))
    fonts.set(q("ascii"), "Arial")
    fonts.set(q("hAnsi"), "Arial")
    fonts.set(q("cs"), "Arial")
    size = ET.SubElement(rpr, q("sz"))
    size.set(q("val"), "18")
    size_cs = ET.SubElement(rpr, q("szCs"))
    size_cs.set(q("val"), "18")
    color_el = ET.SubElement(rpr, q("color"))
    color_el.set(q("val"), color)
    if bold:
        ET.SubElement(rpr, q("b"))
    if underline:
        u = ET.SubElement(rpr, q("u"))
        u.set(q("val"), "single")
    return rpr


def set_cell_text(cell, text, header=False, total=False, right=False):
    p = ET.SubElement(cell, q("p"))
    ppr = ET.SubElement(p, q("pPr"))
    spacing = ET.SubElement(ppr, q("spacing"))
    spacing.set(q("before"), "0")
    spacing.set(q("after"), "0")
    spacing.set(q("line"), "220")
    spacing.set(q("lineRule"), "auto")
    if right:
        jc = ET.SubElement(ppr, q("jc"))
        jc.set(q("val"), "right")
    run = ET.SubElement(p, q("r"))
    color = "FFFFFF" if header else "000000"
    font_properties(run, bold=header or total, color=color)
    t = ET.SubElement(run, q("t"))
    t.text = text


def add_table(rows, widths, right_columns=()):
    tbl = ET.Element(q("tbl"))
    tblpr = ET.SubElement(tbl, q("tblPr"))
    tblw = ET.SubElement(tblpr, q("tblW"))
    tblw.set(q("w"), str(sum(widths)))
    tblw.set(q("type"), "dxa")
    layout = ET.SubElement(tblpr, q("tblLayout"))
    layout.set(q("type"), "fixed")
    borders = ET.SubElement(tblpr, q("tblBorders"))
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        edge = ET.SubElement(borders, q(side))
        edge.set(q("val"), "single")
        edge.set(q("sz"), "4")
        edge.set(q("space"), "0")
        edge.set(q("color"), "7A1F2B")
    cell_margins = ET.SubElement(tblpr, q("tblCellMar"))
    for side, value in (("top", "60"), ("left", "90"), ("bottom", "60"), ("right", "90")):
        edge = ET.SubElement(cell_margins, q(side))
        edge.set(q("w"), value)
        edge.set(q("type"), "dxa")
    grid = ET.SubElement(tbl, q("tblGrid"))
    for width in widths:
        col = ET.SubElement(grid, q("gridCol"))
        col.set(q("w"), str(width))
    for ri, row in enumerate(rows):
        tr = ET.SubElement(tbl, q("tr"))
        trpr = ET.SubElement(tr, q("trPr"))
        ET.SubElement(trpr, q("cantSplit"))
        if ri == 0:
            header = ET.SubElement(trpr, q("tblHeader"))
            header.set(q("val"), "true")
        is_total = row[0].strip().lower().startswith("total ")
        for ci, value in enumerate(row):
            tc = ET.SubElement(tr, q("tc"))
            tcpr = ET.SubElement(tc, q("tcPr"))
            tcw = ET.SubElement(tcpr, q("tcW"))
            tcw.set(q("w"), str(widths[ci]))
            tcw.set(q("type"), "dxa")
            if ri == 0 or is_total:
                shd = ET.SubElement(tcpr, q("shd"))
                shd.set(q("val"), "clear")
                shd.set(q("color"), "auto")
                shd.set(q("fill"), "7A1F2B" if ri == 0 else "E9E9E9")
            valign = ET.SubElement(tcpr, q("vAlign"))
            valign.set(q("val"), "center")
            set_cell_text(tc, value, header=(ri == 0), total=is_total, right=(ci in right_columns and ri != 0))
    return tbl


def paragraph_hyperlink(label, url, rid):
    p = new_paragraph("body", None)
    hyperlink = ET.SubElement(p, q("hyperlink"))
    hyperlink.set(R + "id", rid)
    run = ET.SubElement(hyperlink, q("r"))
    rpr = ET.SubElement(run, q("rPr"))
    style = ET.SubElement(rpr, q("rStyle"))
    style.set(q("val"), "Hyperlink")
    t = ET.SubElement(run, q("t"))
    t.text = label
    return p


def replace_body(base_parts, elements):
    root = ET.fromstring(base_parts["word/document.xml"])
    body_el = root.find(q("body"))
    sectpr = body_el.find(q("sectPr"))
    for child in list(body_el):
        body_el.remove(child)
    for element in elements:
        body_el.append(element)
    if sectpr is not None:
        body_el.append(sectpr)
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)


def add_source_relationships(rels_bytes, urls):
    root = ET.fromstring(rels_bytes)
    existing = {rel.get("Target"): rel.get("Id") for rel in root if rel.get("Type", "").endswith("/hyperlink")}
    ids = [int(match.group(1)) for rel in root for match in [re.fullmatch(r"rId(\d+)", rel.get("Id", ""))] if match]
    next_id = max(ids or [0]) + 1
    url_to_rid = {}
    for url in urls:
        if url in existing:
            url_to_rid[url] = existing[url]
            continue
        rel = ET.SubElement(root, REL + "Relationship")
        rid = "rId" + str(next_id)
        next_id += 1
        rel.set("Id", rid)
        rel.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink")
        rel.set("Target", url)
        rel.set("TargetMode", "External")
        url_to_rid[url] = rid
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True), url_to_rid


def package_docx(output_path, document_xml, rels_xml=None):
    updated = {"word/document.xml": document_xml}
    if rels_xml is not None:
        updated["word/_rels/document.xml.rels"] = rels_xml
    with zipfile.ZipFile(REFERENCE, "r") as source, zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            target.writestr(info, updated.get(info.filename, source.read(info.filename)))
    with zipfile.ZipFile(output_path, "r") as check:
        parts = {name: check.read(name) for name in check.namelist()}
    if set(parts) != set(BASE_PARTS):
        raise RuntimeError("DOCX package part inventory changed")
    allowed = {"word/document.xml"}
    if rels_xml is not None:
        allowed.add("word/_rels/document.xml.rels")
    changed = {name for name in parts if parts[name] != BASE_PARTS[name]}
    if changed != allowed:
        raise RuntimeError(f"Unexpected package part changes for {output_path.name}: {sorted(changed)}")
    return hashlib.sha256(output_path.read_bytes()).hexdigest()


def build_consent(path, title, items):
    verify_reference()
    elements = consent_body(title, items)
    document_xml = replace_body(BASE_PARTS, elements)
    digest = package_docx(path, document_xml)
    print(f"CREATED {path.name} sha256={digest}")


def build_budget(path):
    verify_reference()
    supabase_pricing = "https://supabase.com/pricing"
    supabase_backups = "https://supabase.com/docs/guides/platform/backups"
    supabase_smtp = "https://supabase.com/docs/guides/auth/auth-smtp"
    vercel_pricing = "https://vercel.com/pricing"
    vercel_domain = "https://vercel.com/docs/domains/set-up-custom-domain"
    resend_pricing = "https://resend.com/pricing?product=transactional"
    namecheap_price = "https://www.namecheap.com/support/knowledgebase/article.aspx/10840/2201/com-price-change-november-1-2026/"
    namecheap_icann = "https://www.namecheap.com/support/knowledgebase/article.aspx/1256/2201/what-is-the-icann-fee/"
    bsp_rate = "https://www.bsp.gov.ph/statistics/external/day99.aspx"
    urls = [supabase_pricing, supabase_backups, supabase_smtp, vercel_pricing, vercel_domain, resend_pricing, namecheap_price, namecheap_icann, bsp_rate]
    rels_xml, url_rids = add_source_relationships(BASE_PARTS["word/_rels/document.xml.rels"], urls)

    elements = [
        new_paragraph("start_blank", None),
        new_paragraph("title", "Budget Breakdown for Website Hosting"),
        new_paragraph("blank", None),
        normal("body", STUDY_TITLE),
        normal("body", "Prepared for the Kodigo capstone prototype. This estimate separates an academic demonstration setup from paid production hosting."),
        normal("body", "Prices were checked on 8 November 2026. USD amounts use the latest BSP reference rate available on 6 November 2026: PHP 63.143 per US$1. Taxes, card conversion charges, and usage overages are excluded."),
        normal("heading", "Academic prototype estimate"),
        normal("body", "The prototype estimate uses free plans for the web application, database, and low-volume authentication email, plus one custom .com domain. It is intended for academic demonstrations and limited beta evaluation."),
        add_table([
            ["Cost component", "Basis and limits", "First year", "Renewal year"],
            ["Frontend hosting and HTTPS", "Vercel Hobby for an academic demo; automatic HTTPS certificate after domain verification.", "PHP 0", "PHP 0"],
            ["Database, authentication, and storage", "Supabase Free; 500 MB database and 1 GB file storage. Inactive projects may pause after one week.", "PHP 0", "PHP 0"],
            ["Authentication email", "Resend Free through custom SMTP; up to 3,000 emails monthly and 100 daily, with a verified sending domain.", "PHP 0", "PHP 0"],
            ["Custom .com domain", "Namecheap standard rate: US$15.98 registration plus US$0.20 ICANN fee; US$19.98 renewal plus US$0.20 fee.", "PHP 1,022", "PHP 1,274"],
            ["Database export and backup", "Manual export and offline copy; staff time and any paid remote storage are not priced.", "PHP 0 service fee", "PHP 0 service fee"],
            ["Total vendor cash estimate", "Rounded to whole pesos; taxes and usage overages excluded.", "PHP 1,022", "PHP 1,274"],
        ], [1800, 4560, 1500, 1500], right_columns=(2, 3)),
        normal("heading", "Fit with the thesis budget"),
        normal("body", "Chapter 3, Table 3.3 allocates PHP 1,500 for Cloud Hosting (Supabase) and PHP 1,500 for Domain and Web Hosting, PHP 3,000 combined. The prototype estimate is within that allocation. The difference is a contingency for taxes, price changes, or a later upgrade; it is not a prepaid provider credit."),
        normal("heading", "Production option"),
        normal("body", "For continuous use by an operating business, use the paid provider plans below. The annual service estimates include the first project on Supabase Pro and keep authentication email within the Resend Free allowance."),
        add_table([
            ["Production component", "Price basis", "Annual estimate"],
            ["Vercel Pro frontend", "US$20 per month; PHP 15,154 per year.", "PHP 15,154"],
            ["Supabase Pro database and Auth", "US$25 per month; includes daily database backups retained for 7 days; PHP 18,943 per year.", "PHP 18,943"],
            ["Resend authentication email", "Free within 3,000 emails monthly and 100 daily; verified sender domain required.", "PHP 0"],
            ["Custom .com domain", "US$16.18 for first-year registration; US$20.18 for renewal, including the ICANN fee.", "PHP 1,022 year 1 / PHP 1,274 renewal"],
            ["HTTPS certificate", "Automatically provisioned by Vercel after domain verification.", "PHP 0"],
            ["Total first year", "US$45 monthly services plus the first-year domain; before tax and overages.", "PHP 35,119"],
            ["Total renewal year", "US$45 monthly services plus the annual domain renewal; before tax and overages.", "PHP 35,371"],
        ], [2400, 4560, 2400], right_columns=(2,)),
        normal("heading", "Budget and operational notes"),
        normal("body", "The existing PHP 3,000 hosting allocation supports a limited academic demo on free tiers. Supabase Free has no automatic daily database backups and can pause after inactivity; schedule and verify manual exports. Supabase's default email service is limited to project team addresses and 2 messages per hour, so configure the included Resend Free SMTP allowance before inviting outside testers."),
        normal("body", "The paid production estimate annualizes Vercel Pro at US$20 per month and Supabase Pro at US$25 per month. It does not include optional paid SMTP beyond Resend Free limits, point-in-time recovery, extra database or storage usage, extra projects, paid support, tax, or payment-provider currency fees. Revise the project budget before business production deployment."),
        normal("heading", "Official pricing and service references"),
    ]
    links = [
        ("Supabase plans and usage limits", supabase_pricing),
        ("Supabase backup policy", supabase_backups),
        ("Supabase custom SMTP limits", supabase_smtp),
        ("Vercel plans", vercel_pricing),
        ("Vercel custom domains and automatic SSL", vercel_domain),
        ("Resend transactional email pricing", resend_pricing),
        ("Namecheap .com registration and renewal rates", namecheap_price),
        ("Namecheap ICANN fee", namecheap_icann),
        ("BSP daily PHP per US dollar rate", bsp_rate),
    ]
    for label, url in links:
        elements.append(paragraph_hyperlink(label + " (checked 8 November 2026)", url, url_rids[url]))

    document_xml = replace_body(BASE_PARTS, elements)
    digest = package_docx(path, document_xml, rels_xml)
    print(f"CREATED {path.name} sha256={digest}")


def main():
    verify_reference()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_consent(OUTPUT_DIR / "Informed Consent for Interview.docx", "Informed Consent for Interview", INTERVIEW_ITEMS)
    build_consent(OUTPUT_DIR / "Informed Consent for Pre-Survey.docx", "Informed Consent for Pre-Survey", PRESURVEY_ITEMS)
    build_consent(OUTPUT_DIR / "Informed Consent for Post-Survey.docx", "Informed Consent for Post-Survey", POSTSURVEY_ITEMS)
    build_budget(OUTPUT_DIR / "Budget Breakdown for Website Hosting.docx")


if __name__ == "__main__":
    main()
