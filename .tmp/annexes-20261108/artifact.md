# Execution contract for the consent and hosting budget annexes

## Reference
- Retained reference: C:\Users\verga\Downloads\REPRINT FINAL REQ\Informed Consent v2 - READY TO PRINT.docx
- SHA-256: bf3999bf56204a6b7142a3dd84e18e6d99a52ce0e8cc77a0155985b0cca09904
- Render: C:\Kodigo v0.1.0\.tmp\consent-reference-render-2\page-1.png (one page)
- Evidence: C:\Kodigo v0.1.0\.tmp\consent-style.json; section audit recorded below.
- Source stays unchanged. New files will be made as copies of this reference DOCX.

## Page system
- One portrait US Letter section, 8.50 x 11.00 inches.
- Margins: 1.00 inch on all sides; header and footer distances 0.4917 inch.
- One column; section starts on a new page.
- Different first page: off. Odd/even headers: not enabled.
- One centered image logo in word/header1.xml; the header repeats on all pages. Footer contains no visible text.

## Typography and components
- Arial 9 pt throughout source body; title and section labels are bold. Main title is centered; body is left aligned.
- Normal paragraph style supplies the line spacing and paragraph rhythm; most paragraphs have no direct before/after spacing.
- No title rule, numbered lists, tables, page numbers, or content controls. A blank paragraph with a top border separates contact details from the agreement block.
- Preserve the source SWU Information Technology logo, letter-size geometry, margins, Arial typography, simple black text, and compact heading treatment. New consent forms may add method-specific headings and checkboxes. The budget may add compact tables with clear column headers and simple borders using the same font and restrained appearance.

## Content flow and editable slots
- Source order: centered consent title; salutation; study introduction and purpose; participation instructions; risks; voluntary withdrawal; confidentiality; researcher contacts; thin top-border separator; agreement text; name/signature/date lines.
- Editable body slots: word/document.xml paragraphs corresponding to source body paragraphs 1-26. Rebuild only the body content for each new annex while keeping the section properties intact.
- Preserve the complete header/logo relationship and all source package parts outside the body. Budget source links may add hyperlink relationships in word/_rels/document.xml.rels; no other relationships should change.
- Intended consent content: one interview form for owner/managers, one pre-survey form for operational respondents, and one post-survey form for a client representative after beta testing. Use the title and scope established by C:\Kodigo v0.1.0\thesis_build.docx.
- Intended budget content: first-year low-traffic academic prototype estimate, renewal estimate, optional paid production scenario, stated currency basis, limits, and official pricing references.

## Package preservation baseline
- word/document.xml is the intended editable body.
- word/_rels/document.xml.rels is preserve-only except for source hyperlinks in the budget file.
- Preserve all other package parts byte-for-byte:
  - [Content_Types].xml: 1732 bytes, SHA-256 93ee67811ba2ec325a2b3abe7b607c1c0d9b79877ba09c0d2d0fb8ef931a0bfd
  - _rels/.rels: 443 bytes, SHA-256 450973054150e155baa20de9ae4d682cf52545a537ed2b84ed78400b7dc15ddc
  - word/header1.xml: 2840 bytes, SHA-256 6872d872280678f574d2a95117155831f36b4054aaa83b653ac36cd02d661b1b
  - word/_rels/header1.xml.rels: 288 bytes, SHA-256 6da7a486da2022851359dddebe4d23b4799d05acbf35790f6c5fbcde09ac3ec9
  - word/media/image1.png: 5603 bytes, SHA-256 85e5e122d1413bcca080ea18bb9d49a0205684b8e8855af06eb0b202496f3d1b
  - word/styles.xml: 16028 bytes, SHA-256 9fcd3be7d9e5a6f30369dfbf6ec000eb4a3551730b7447243bea6fcdf6e2a4e
  - word/numbering.xml: 1690 bytes, SHA-256 d2a3e08465525eee874ea10d780540816951a37b115e90f1cd56aefdd76adc2e
  - word/settings.xml: 2152 bytes, SHA-256 26f2853fde05b88d4b0a9da0bb016d56a896901f60c9272dddf33c3f3fa61e4a
  - word/fontTable.xml: 1963 bytes, SHA-256 ee00e1c3839fdebc20b764fd1005fa54886a0c7b858436fa54ca6ebf9900f492
  - word/_rels/fontTable.xml.rels: 427 bytes, SHA-256 b7aeb6addef2217561f3fd1ef4cfee4d4444f69d8c2733e90248df44c68e0b78
  - word/fonts/Play-bold.ttf: 146600 bytes, SHA-256 b0270d79073f111f528ee9c25503ab9ec92dc19517198dcf7528b00f89fbd4b7
  - word/fonts/Play-regular.ttf: 139616 bytes, SHA-256 e1e9c9a87d56ac9897b41de72db27e5b5c7f97e1583690e338be7d4dd6c68deb
  - word/theme/theme1.xml: 8717 bytes, SHA-256 e7948e69d1ab51203d82e7e57d491987a16229547a1b6bfd124133a3a895c0ac
  - customXML/item1.xml: 581 bytes, SHA-256 c7fe31a9b5a1dff3236312f2a3f9dffb732eae586c58efa4d41a954a552ff8e5
  - customXML/itemProps1.xml: 404 bytes, SHA-256 fc2e321bb5ca54d5f2b99b99f91d681d004417098918a318be88fe525218c9a3
  - customXML/_rels/item1.xml.rels: 295 bytes, SHA-256 26ac718f80df621ee703e3c0f143a63034967c5fe65fbfdcefbf96419235355e
  - docProps/core.xml: 482 bytes, SHA-256 0b8cc4b80c83bee1c993a0bc9088c87b530412eaad9e384a3e7074575db9fa3a
- Baseline document relationships include one unused mailto hyperlink for a source researcher, header relationship rId8, and theme/settings/font/numbering/styles/customXml relationships. Preserve existing relationships and targets.

## Fidelity gates
- Verify reference SHA-256 again before building.
- Keep new consent forms recognizably derived from the reference and suitable for printing.
- Render every final DOCX to page PNGs; inspect every page for text clipping, broken tables, header/logo placement, signature space, and page breaks.
- Compare package-part inventories and hashes; any changes outside the explicitly editable document body and budget source-link relationships fail fidelity review.
- Keep the retained reference unchanged.
