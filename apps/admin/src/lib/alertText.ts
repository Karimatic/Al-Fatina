/**
 * The bell's alerts come from the server in French (they are also logged and sent to Telegram).
 * In the Arabic admin they are shown in Arabic, rebuilt from the same message: one pattern per
 * kind; anything unexpected stays as it was rather than being half translated.
 */
import { isAr } from "../i18n";

const STAGE_AR: Record<string, string> = { confirmation: "التأكيد", "préparation": "التحضير", "expédition": "الشحن" };

/** "2 h 05", "3 j", "45 min" → Arabic units */
const durationAr = (d: string) =>
  d
    .replace(/^(\d+) j$/, "$1 يوم")
    .replace(/^(\d+) h (\d+)$/, "$1 سا $2 د")
    .replace(/^(\d+) h$/, "$1 سا")
    .replace(/^(\d+) min$/, "$1 دقيقة");

const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Commande (\S+) en retard \((.+?)\) de (.+)\.$/, (m) => `الطلبية ${m[1]} متأخرة (${STAGE_AR[m[2]!] ?? m[2]}) بـ ${durationAr(m[3]!)}.`],
  [/^(\d+) commandes ne sont pas confirmées depuis plus de (.+)\.$/, (m) => `${m[1]} طلبيات غير مؤكدة منذ أكثر من ${durationAr(m[2]!)}.`],
  [/^(\d+) commandes? (?:sont prêtes|est prête) à expédier\.$/, (m) => `${m[1]} طلبية جاهزة للشحن.`],
  [/^Rupture : (.+) \((.+)\) est épuisé\.$/, (m) => `نفاد المخزون: ${m[1]} (${m[2]}).`],
  [/^Stock critique : (.+) \((.+)\), plus qu'une pièce\.$/, (m) => `مخزون حرج: ${m[1]} (${m[2]})، بقيت قطعة واحدة.`],
  [/^(\d+) produits? publiés? n'(?:ont|a) aucune photo/, (m) => `${m[1]} منتج منشور بدون أي صورة: أضيفي الصور (الزبونات وكتالوج فيسبوك / إنستغرام يتجاهلونها).`],
  [/^Livraison échouée (\S+) : c'est l'heure de rappeler la cliente\.$/, (m) => `توصيل فاشل ${m[1]}: حان وقت الاتصال بالزبونة.`],
  [/^Problème signalé par la cliente sur (\S+) : ([\s\S]*)$/, (m) => `مشكلة أبلغت عنها الزبونة في ${m[1]}: ${m[2]}`],
  [/^Demande d'échange (\S+) : ([\s\S]*)$/, (m) => `طلب تبديل ${m[1]}: ${m[2]}`],
];

export function alertText(message: string): string {
  if (!isAr) return message;
  for (const [re, ar] of RULES) {
    const m = message.match(re);
    if (m) return ar(m);
  }
  return message;
}
