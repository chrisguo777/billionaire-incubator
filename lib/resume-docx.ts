// 把结构化简历生成 Word（.docx）。在浏览器里运行，页面点「下载 Word」时才加载。
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import type { ResumeDoc } from "./resume-doc";

const FONT = "Calibri";
const SIZE = 21; // 半磅单位：10.5pt
const PAGE_WIDTH = 12240; // Letter，单位 twip
const MARGIN = 864; // 0.6 英寸
const RIGHT_TAB = PAGE_WIDTH - MARGIN * 2;

export async function buildDocx(doc: ResumeDoc): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [new TextRun({ text: doc.title, bold: true, size: 32, font: FONT })],
    }),
  ];

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "111111", space: 1 } },
        children: [new TextRun({ text: section.heading, bold: true, size: SIZE, font: FONT, characterSpacing: 20 })],
      }),
    );
    for (const entry of section.entries) {
      children.push(
        new Paragraph({
          keepNext: true,
          tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
          children: [
            new TextRun({ text: entry.title, bold: true, size: SIZE, font: FONT }),
            ...(entry.location ? [new TextRun({ text: `, ${entry.location}`, size: SIZE, font: FONT })] : []),
            ...(entry.dates ? [new TextRun({ text: `\t${entry.dates}`, size: SIZE, font: FONT })] : []),
          ],
        }),
      );
      if (entry.subtitle) {
        children.push(
          new Paragraph({
            keepNext: entry.bullets.length > 0,
            children: [new TextRun({ text: entry.subtitle, italics: true, size: SIZE, font: FONT })],
          }),
        );
      }
      entry.bullets.forEach((b, i) => {
        children.push(
          new Paragraph({
            numbering: { reference: "resume-bullets", level: 0 },
            spacing: { after: i === entry.bullets.length - 1 ? 120 : 20 },
            children: [new TextRun({ text: b, size: SIZE, font: FONT })],
          }),
        );
      });
    }
    if (section.text) {
      children.push(new Paragraph({ children: [new TextRun({ text: section.text, size: SIZE, font: FONT })] }));
    }
  }

  const document = new Document({
    creator: "Resume Agent Demo",
    title: doc.title,
    numbering: {
      config: [
        {
          reference: "resume-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 280, hanging: 200 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: 15840 },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(document);
}
