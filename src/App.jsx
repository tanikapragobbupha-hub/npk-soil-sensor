import { useState, useEffect } from "react";
import {
  Wifi, WifiOff, Clock, Sprout, Leaf, BarChart3, History, Book, QrCode,
  ChevronLeft, CheckCircle2, AlertTriangle, XCircle, Loader2, AlertCircle, Inbox,
  Droplets, Thermometer, Zap, FlaskConical,
  TrendingUp, TrendingDown, Search, Copy, Check,
} from "lucide-react";
import { getLatestSoilReading } from "./lib/supabase.js";

const TOKENS = {
  paper: "#EFE6D8",
  paperDeep: "#E3D7C2",
  ink: "#2B241C",
  inkSoft: "#6B5F4E",
  soil: "#3D3226",
  n: "#2F6690",
  nSoft: "#DCE9F0",
  p: "#A13D3D",
  pSoft: "#F3DEDE",
  k: "#B4791E",
  kSoft: "#F5E6CD",
  ok: "#4A7A3D",
  okSoft: "#E1EBDA",
  warn: "#8A5A10",
  warnSoft: "#F5E6CD",
  bad: "#A13D3D",
  badSoft: "#F3DEDE",
};

const DEVICE_ID = "NPK-001";
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // ถือว่า "เชื่อมต่ออยู่" ถ้าข้อมูลใหม่กว่า 2 นาที

function formatThaiDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " น.";
}

/* ============================================
   คำนวณจากข้อมูลดิน (รับ soil object ที่ดึงมาจาก Supabase)
   ============================================ */

// การ์ดหลัก N/P/K
function buildNutrients(soil) {
  return [
    { key: "n", label: "ไนโตรเจน", value: soil.n, unit: "mg/kg", range: [40, 80], color: TOKENS.n, soft: TOKENS.nSoft },
    { key: "p", label: "ฟอสฟอรัส", value: soil.p, unit: "mg/kg", range: [15, 30], color: TOKENS.p, soft: TOKENS.pSoft },
    { key: "k", label: "โพแทสเซียม", value: soil.k, unit: "mg/kg", range: [80, 120], color: TOKENS.k, soft: TOKENS.kSoft },
  ];
}

// การ์ดรอง — ไม่ใช้คิดคะแนนแนะนำพืช
function buildSecondaryMetrics(soil) {
  return [
    { key: "moisture", label: "ความชื้นดิน", value: soil.moisture, unit: "%", icon: Droplets },
    { key: "temperature", label: "อุณหภูมิดิน", value: soil.temperature, unit: "°C", icon: Thermometer },
    { key: "ec", label: "ค่าการนำไฟฟ้า (EC)", value: soil.ec, unit: "µS/cm", icon: Zap },
    { key: "ph", label: "ค่ากรด-ด่าง (pH)", value: soil.ph, unit: "", icon: FlaskConical },
  ];
}

// ข้อมูลจากตาราง plants + nutrient_criteria ใน Supabase
// ⚠️ ค่า min/max ทุกตัวตอนนี้เป็น is_placeholder: true — ยังไม่ใช่ค่าจริง
// รอข้อมูลยืนยันจากกรมพัฒนาที่ดิน (LDD) หรือแหล่งทางการอื่น
const PLACEHOLDER_SOURCE = {
  source: "ข้อมูลตัวอย่าง (Demo) — ยังไม่ใช่ค่าจริง",
  analysis_method: null,
  reference: "รอข้อมูลจากกรมพัฒนาที่ดิน (LDD) หรือแหล่งทางการอื่น",
  is_placeholder: true,
};

const PLANTS = [
  {
    name_th: "ข้าวโพด",
    name_common: "Corn",
    description: "ชอบดินที่มีไนโตรเจนสูง ระบายน้ำดี",
    criteria: {
      n: { min: 40, max: 80, unit: "mg/kg", ...PLACEHOLDER_SOURCE },
      p: { min: 15, max: 30, unit: "mg/kg", ...PLACEHOLDER_SOURCE },
      k: { min: 80, max: 120, unit: "mg/kg", ...PLACEHOLDER_SOURCE },
    },
  },
  {
    name_th: "มันสำปะหลัง",
    name_common: "Cassava",
    description: "ทนดินเลว ต้องการโพแทสเซียมค่อนข้างสูง",
    criteria: {
      n: { min: 20, max: 50, unit: "mg/kg", ...PLACEHOLDER_SOURCE },
      p: { min: 10, max: 25, unit: "mg/kg", ...PLACEHOLDER_SOURCE },
      k: { min: 100, max: 160, unit: "mg/kg", ...PLACEHOLDER_SOURCE },
    },
  },
];

function levelOf(value, [lo, hi]) {
  if (value < lo) return { text: "ต่ำ", tone: "low" };
  if (value > hi) return { text: "สูง", tone: "high" };
  return { text: "เหมาะสม", tone: "ok" };
}

function evaluateNutrient(value, [lo, hi]) {
  if (value < lo) return { status: "low", diff: lo - value };
  if (value > hi) return { status: "high", diff: value - hi };
  return { status: "ok", diff: 0 };
}

// รับ soil (ค่า N/P/K ล่าสุดจาก Supabase) เข้ามาคำนวณแทนค่าคงที่แบบเดิม
function scorePlant(plant, soil) {
  const n = evaluateNutrient(soil.n, [plant.criteria.n.min, plant.criteria.n.max]);
  const p = evaluateNutrient(soil.p, [plant.criteria.p.min, plant.criteria.p.max]);
  const k = evaluateNutrient(soil.k, [plant.criteria.k.min, plant.criteria.k.max]);
  const okCount = [n, p, k].filter((x) => x.status === "ok").length;
  let verdict;
  if (okCount === 3) verdict = { text: "เหมาะมาก", tone: "ok" };
  else if (okCount >= 1) verdict = { text: "เหมาะปานกลาง", tone: "warn" };
  else verdict = { text: "ไม่ค่อยเหมาะ", tone: "bad" };
  return { n, p, k, okCount, verdict };
}

/* ---------- ชิ้นส่วนที่ใช้ร่วมกัน ---------- */

function LevelPill({ level }) {
  const styles = {
    low: { bg: "#F3DEDE", fg: "#A13D3D" },
    ok: { bg: TOKENS.okSoft, fg: TOKENS.ok },
    high: { bg: "#F5E6CD", fg: "#8A5A10" },
  }[level.tone];
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: styles.bg, color: styles.fg }}>
      {level.text}
    </span>
  );
}

function NutrientCard({ n }) {
  const level = levelOf(n.value, n.range);
  const pct = Math.min(100, Math.max(4, (n.value / (n.range[1] * 1.3)) * 100));
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "#FBF8F2", borderLeft: `5px solid ${n.color}` }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm" style={{ color: TOKENS.inkSoft }}>{n.label}</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-3xl font-semibold" style={{ color: TOKENS.ink }}>{n.value}</span>
            <span className="text-sm" style={{ color: TOKENS.inkSoft }}>{n.unit}</span>
          </div>
        </div>
        <LevelPill level={level} />
      </div>
      <div className="h-1.5 rounded-full w-full" style={{ background: n.soft }}>
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: n.color }} />
      </div>
      <div className="text-xs" style={{ color: TOKENS.inkSoft }}>
        ช่วงเหมาะสม {n.range[0]}–{n.range[1]} {n.unit}
      </div>
    </div>
  );
}

function SecondaryMetricCard({ metric }) {
  const Icon = metric.icon;
  return (
    <div className="rounded-xl p-3 flex items-center gap-2.5" style={{ background: "#FBF8F2" }}>
      <div className="rounded-full p-1.5 flex items-center justify-center" style={{ background: TOKENS.paper }}>
        <Icon size={14} color={TOKENS.inkSoft} />
      </div>
      <div>
        <div className="text-[10px]" style={{ color: TOKENS.inkSoft }}>{metric.label}</div>
        <div className="text-sm font-semibold" style={{ color: TOKENS.ink }}>
          {metric.value}{metric.unit ? ` ${metric.unit}` : ""}
        </div>
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 py-2 px-1 flex-1">
      <Icon size={20} color={active ? TOKENS.ok : TOKENS.inkSoft} strokeWidth={active ? 2.3 : 1.8} />
      <span className="text-[10px]" style={{ color: active ? TOKENS.ok : TOKENS.inkSoft, fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </button>
  );
}

/* ---------- สถานะ loading / error / ไม่มีข้อมูล (ใช้ร่วมกันทุกหน้าที่ต้องใช้ soil data) ---------- */

function StatusScreen({ icon: Icon, title, detail, tone = "neutral" }) {
  const color = tone === "error" ? TOKENS.bad : tone === "loading" ? TOKENS.inkSoft : TOKENS.warn;
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
      <Icon size={28} color={color} className={tone === "loading" ? "animate-spin" : ""} />
      <div className="text-base font-semibold" style={{ color: TOKENS.ink }}>{title}</div>
      {detail && <div className="text-sm" style={{ color: TOKENS.inkSoft }}>{detail}</div>}
    </div>
  );
}

/* ---------- หน้า Dashboard ---------- */

function DashboardPage({ goTo, soil }) {
  const connected = (Date.now() - new Date(soil.created_at).getTime()) < ONLINE_THRESHOLD_MS;
  const NUTRIENTS = buildNutrients(soil);
  const SECONDARY_METRICS = buildSecondaryMetrics(soil);
  const overallOk = NUTRIENTS.every((n) => levelOf(n.value, n.range).tone === "ok");

  return (
    <div className="flex flex-col flex-1">
      <div className="px-5 pt-6 pb-5" style={{ background: TOKENS.soil }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs tracking-wide" style={{ color: "#C9BFA9" }}>NPK Soil Sensor</div>
            <div className="text-xl font-semibold text-white mt-0.5">แปลงทดสอบ · บ้านเหมืองกา</div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: connected ? "rgba(74,122,61,0.25)" : "rgba(161,61,61,0.25)" }}>
            {connected ? <Wifi size={14} color="#9FD98A" /> : <WifiOff size={14} color="#E39B9B" />}
            <span className="text-xs font-medium" style={{ color: connected ? "#9FD98A" : "#E39B9B" }}>
              {connected ? "เชื่อมต่ออยู่" : "ขาดการเชื่อมต่อ"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-4" style={{ color: "#C9BFA9" }}>
          <Clock size={13} />
          <span className="text-xs">วัดล่าสุด {formatThaiDateTime(soil.created_at)}</span>
        </div>
      </div>

      <div className="px-5 -mt-3">
        <div className="rounded-2xl px-4 py-3.5 flex items-center gap-3" style={{ background: overallOk ? TOKENS.okSoft : TOKENS.kSoft, boxShadow: "0 4px 14px rgba(43,36,28,0.08)" }}>
          <Sprout size={22} color={overallOk ? TOKENS.ok : TOKENS.k} />
          <div>
            <div className="text-sm font-semibold" style={{ color: overallOk ? TOKENS.ok : "#8A5A10" }}>
              {overallOk ? "ดินโดยรวมอยู่ในเกณฑ์ดี" : "มีธาตุอาหารที่ควรปรับ"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: TOKENS.inkSoft }}>
              {NUTRIENTS.filter((n) => levelOf(n.value, n.range).tone !== "ok")
                .map((n) => `${n.label} ${levelOf(n.value, n.range).text}กว่าเกณฑ์`)
                .join(" · ") || "ทุกธาตุอยู่ในเกณฑ์เหมาะสม"}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 mt-4 flex flex-col gap-3 flex-1">
        {NUTRIENTS.map((n) => <NutrientCard key={n.key} n={n} />)}

        <div className="grid grid-cols-2 gap-2 mt-1">
          {SECONDARY_METRICS.map((m) => <SecondaryMetricCard key={m.key} metric={m} />)}
        </div>

        <button
          onClick={() => goTo("recommend")}
          className="mt-2 rounded-2xl py-3.5 flex items-center justify-center gap-2 text-sm font-medium"
          style={{ background: TOKENS.soil, color: "#F5F0E6" }}
        >
          <Leaf size={16} /> ดูคำแนะนำพืชที่เหมาะกับดินนี้
        </button>
      </div>
    </div>
  );
}

/* ---------- หน้าแนะนำพืชจากดิน ---------- */

const LABEL = { n: "ไนโตรเจน (N)", p: "ฟอสฟอรัส (P)", k: "โพแทสเซียม (K)" };
const COLOR = { n: TOKENS.n, p: TOKENS.p, k: TOKENS.k };

function NutrientLine({ code, evalResult, criterion }) {
  const { status, diff } = evalResult;
  const icon =
    status === "ok" ? <CheckCircle2 size={16} color={TOKENS.ok} /> :
    status === "low" ? <AlertTriangle size={16} color={TOKENS.warn} /> :
    <XCircle size={16} color={TOKENS.bad} />;
  const text =
    status === "ok" ? "อยู่ในช่วงที่เหมาะสมแล้ว" :
    status === "low" ? `ต่ำกว่าที่ต้องการอยู่ ${diff} ${criterion.unit} — ควรเพิ่ม` :
    `สูงกว่าที่ต้องการอยู่ ${diff} ${criterion.unit} — ควรลด`;
  return (
    <div className="flex items-start gap-2 py-1.5">
      {icon}
      <div className="text-sm">
        <span className="font-medium" style={{ color: COLOR[code] }}>{LABEL[code]}</span>
        <span style={{ color: TOKENS.inkSoft }}> — {text}</span>
        {criterion.is_placeholder && (
          <span
            className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full align-middle"
            style={{ background: TOKENS.warnSoft, color: TOKENS.warn }}
            title={`${criterion.source} · ${criterion.reference}`}
          >
            ค่าตัวอย่าง
          </span>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }) {
  const styles = {
    ok: { bg: TOKENS.okSoft, fg: TOKENS.ok },
    warn: { bg: TOKENS.warnSoft, fg: TOKENS.warn },
    bad: { bg: TOKENS.badSoft, fg: TOKENS.bad },
  }[verdict.tone];
  return (
    <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: styles.bg, color: styles.fg }}>
      {verdict.text}
    </span>
  );
}

function PlantCard({ plant, soil }) {
  const result = scorePlant(plant, soil);
  return (
    <div className="rounded-2xl p-4" style={{ background: "#FBF8F2", boxShadow: "0 4px 14px rgba(43,36,28,0.06)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold" style={{ color: TOKENS.ink }}>{plant.name_th}</div>
          <div className="text-xs" style={{ color: TOKENS.inkSoft }}>{plant.name_common}</div>
        </div>
        <VerdictBadge verdict={result.verdict} />
      </div>
      <p className="text-xs mt-2" style={{ color: TOKENS.inkSoft }}>{plant.description}</p>
      <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${TOKENS.paper}` }}>
        <NutrientLine code="n" evalResult={result.n} criterion={plant.criteria.n} />
        <NutrientLine code="p" evalResult={result.p} criterion={plant.criteria.p} />
        <NutrientLine code="k" evalResult={result.k} criterion={plant.criteria.k} />
      </div>
      <div className="text-[10px] mt-2.5" style={{ color: TOKENS.inkSoft }}>
        เกณฑ์ธาตุอาหารด้านบนยังเป็นข้อมูลตัวอย่าง — {plant.criteria.n.reference}
      </div>
    </div>
  );
}

function RecommendPage({ goTo, soil }) {
  const ranked = [...PLANTS].sort((a, b) => scorePlant(b, soil).okCount - scorePlant(a, soil).okCount);
  return (
    <div className="flex flex-col flex-1">
      <div className="px-5 pt-6 pb-5 flex items-center gap-3" style={{ background: TOKENS.soil }}>
        <button onClick={() => goTo("dashboard")}>
          <ChevronLeft size={20} color="#F5F0E6" />
        </button>
        <div>
          <div className="text-xs" style={{ color: "#C9BFA9" }}>แปลงทดสอบ · บ้านเหมืองกา</div>
          <div className="text-lg font-semibold text-white">แนะนำพืชจากดิน</div>
        </div>
      </div>

      <div className="px-5 -mt-3">
        <div className="rounded-2xl px-4 py-3 flex items-center justify-around" style={{ background: "#FBF8F2", boxShadow: "0 4px 14px rgba(43,36,28,0.08)" }}>
          {(["n", "p", "k"]).map((code) => (
            <div key={code} className="text-center">
              <div className="text-xs" style={{ color: TOKENS.inkSoft }}>{code.toUpperCase()}</div>
              <div className="text-xl font-semibold" style={{ color: COLOR[code] }}>{soil[code]}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-center mt-1.5" style={{ color: TOKENS.inkSoft }}>ค่าดินล่าสุดที่ใช้เทียบ (mg/kg)</div>
      </div>

      <div className="px-5 mt-4 flex flex-col gap-3 flex-1">
        <div className="flex items-center gap-1.5">
          <Leaf size={14} color={TOKENS.ok} />
          <span className="text-xs font-medium" style={{ color: TOKENS.inkSoft }}>เรียงจากพืชที่เหมาะกับดินนี้มากสุด</span>
        </div>
        {ranked.map((plant) => <PlantCard key={plant.name_th} plant={plant} soil={soil} />)}
      </div>
    </div>
  );
}

/* ============================================================
   หน้า Mockup: ประวัติการวัด / ข้อมูลพืช / QR Code
   ⚠️ ประวัติการวัดเป็นข้อมูลตัวอย่างเพื่อสาธิต (ยังไม่ดึงจาก Supabase)
   ============================================================ */

const SITE_URL = "https://npk-soil-sensor.vercel.app";
const QR_SIZE = 33;
const QR_PATH = "M0 0h7v1h-7zM8 0h1v1h-1zM11 0h1v1h-1zM13 0h2v1h-2zM17 0h4v1h-4zM23 0h1v1h-1zM26 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM9 1h1v1h-1zM11 1h1v1h-1zM13 1h2v1h-2zM17 1h1v1h-1zM20 1h1v1h-1zM22 1h1v1h-1zM26 1h1v1h-1zM32 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM9 2h4v1h-4zM14 2h6v1h-6zM23 2h2v1h-2zM26 2h1v1h-1zM28 2h3v1h-3zM32 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM9 3h1v1h-1zM12 3h2v1h-2zM16 3h1v1h-1zM20 3h3v1h-3zM26 3h1v1h-1zM28 3h3v1h-3zM32 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h1v1h-1zM10 4h2v1h-2zM13 4h1v1h-1zM16 4h3v1h-3zM24 4h1v1h-1zM26 4h1v1h-1zM28 4h3v1h-3zM32 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h1v1h-1zM10 5h2v1h-2zM13 5h2v1h-2zM16 5h2v1h-2zM20 5h1v1h-1zM22 5h1v1h-1zM26 5h1v1h-1zM32 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h1v1h-1zM26 6h7v1h-7zM10 7h1v1h-1zM12 7h1v1h-1zM14 7h3v1h-3zM21 7h2v1h-2zM24 7h1v1h-1zM1 8h7v1h-7zM13 8h2v1h-2zM16 8h2v1h-2zM20 8h1v1h-1zM22 8h1v1h-1zM27 8h2v1h-2zM32 8h1v1h-1zM0 9h1v1h-1zM5 9h1v1h-1zM7 9h1v1h-1zM9 9h4v1h-4zM16 9h1v1h-1zM19 9h3v1h-3zM23 9h1v1h-1zM26 9h2v1h-2zM29 9h2v1h-2zM32 9h1v1h-1zM2 10h1v1h-1zM5 10h3v1h-3zM10 10h1v1h-1zM18 10h1v1h-1zM21 10h1v1h-1zM25 10h2v1h-2zM28 10h1v1h-1zM30 10h2v1h-2zM2 11h4v1h-4zM10 11h1v1h-1zM19 11h4v1h-4zM26 11h1v1h-1zM28 11h3v1h-3zM32 11h1v1h-1zM0 12h1v1h-1zM4 12h4v1h-4zM11 12h1v1h-1zM13 12h1v1h-1zM15 12h2v1h-2zM18 12h2v1h-2zM21 12h1v1h-1zM23 12h3v1h-3zM27 12h3v1h-3zM31 12h1v1h-1zM0 13h2v1h-2zM4 13h1v1h-1zM7 13h1v1h-1zM11 13h3v1h-3zM16 13h1v1h-1zM20 13h1v1h-1zM22 13h1v1h-1zM26 13h2v1h-2zM29 13h4v1h-4zM2 14h2v1h-2zM6 14h1v1h-1zM9 14h2v1h-2zM12 14h2v1h-2zM15 14h1v1h-1zM18 14h2v1h-2zM21 14h1v1h-1zM23 14h5v1h-5zM29 14h3v1h-3zM1 15h1v1h-1zM4 15h2v1h-2zM7 15h6v1h-6zM15 15h3v1h-3zM19 15h5v1h-5zM25 15h2v1h-2zM28 15h3v1h-3zM3 16h6v1h-6zM16 16h2v1h-2zM19 16h1v1h-1zM22 16h4v1h-4zM27 16h3v1h-3zM32 16h1v1h-1zM2 17h4v1h-4zM7 17h1v1h-1zM9 17h1v1h-1zM13 17h1v1h-1zM16 17h1v1h-1zM18 17h3v1h-3zM23 17h2v1h-2zM26 17h2v1h-2zM29 17h4v1h-4zM1 18h1v1h-1zM5 18h2v1h-2zM8 18h1v1h-1zM10 18h1v1h-1zM13 18h2v1h-2zM16 18h3v1h-3zM20 18h1v1h-1zM22 18h1v1h-1zM27 18h2v1h-2zM30 18h2v1h-2zM0 19h3v1h-3zM4 19h2v1h-2zM8 19h1v1h-1zM11 19h2v1h-2zM14 19h4v1h-4zM20 19h1v1h-1zM23 19h3v1h-3zM27 19h4v1h-4zM32 19h1v1h-1zM3 20h5v1h-5zM10 20h1v1h-1zM13 20h1v1h-1zM15 20h3v1h-3zM20 20h6v1h-6zM27 20h3v1h-3zM31 20h2v1h-2zM0 21h2v1h-2zM4 21h2v1h-2zM9 21h1v1h-1zM11 21h3v1h-3zM15 21h4v1h-4zM24 21h3v1h-3zM30 21h1v1h-1zM32 21h1v1h-1zM0 22h1v1h-1zM3 22h1v1h-1zM5 22h2v1h-2zM8 22h2v1h-2zM11 22h1v1h-1zM15 22h2v1h-2zM20 22h3v1h-3zM24 22h3v1h-3zM31 22h1v1h-1zM0 23h1v1h-1zM3 23h3v1h-3zM7 23h5v1h-5zM14 23h1v1h-1zM21 23h1v1h-1zM24 23h1v1h-1zM26 23h1v1h-1zM29 23h2v1h-2zM32 23h1v1h-1zM0 24h1v1h-1zM2 24h1v1h-1zM4 24h1v1h-1zM6 24h4v1h-4zM11 24h3v1h-3zM24 24h5v1h-5zM8 25h1v1h-1zM13 25h3v1h-3zM19 25h3v1h-3zM24 25h1v1h-1zM28 25h1v1h-1zM30 25h1v1h-1zM32 25h1v1h-1zM0 26h7v1h-7zM8 26h2v1h-2zM11 26h1v1h-1zM14 26h2v1h-2zM18 26h1v1h-1zM20 26h2v1h-2zM23 26h2v1h-2zM26 26h1v1h-1zM28 26h1v1h-1zM30 26h1v1h-1zM0 27h1v1h-1zM6 27h1v1h-1zM8 27h2v1h-2zM11 27h2v1h-2zM14 27h1v1h-1zM16 27h1v1h-1zM19 27h1v1h-1zM21 27h4v1h-4zM28 27h3v1h-3zM32 27h1v1h-1zM0 28h1v1h-1zM2 28h3v1h-3zM6 28h1v1h-1zM8 28h4v1h-4zM13 28h1v1h-1zM16 28h2v1h-2zM21 28h1v1h-1zM24 28h6v1h-6zM0 29h1v1h-1zM2 29h3v1h-3zM6 29h1v1h-1zM8 29h1v1h-1zM10 29h1v1h-1zM13 29h3v1h-3zM17 29h2v1h-2zM20 29h1v1h-1zM22 29h1v1h-1zM24 29h2v1h-2zM28 29h1v1h-1zM30 29h1v1h-1zM32 29h1v1h-1zM0 30h1v1h-1zM2 30h3v1h-3zM6 30h1v1h-1zM8 30h2v1h-2zM12 30h1v1h-1zM14 30h3v1h-3zM19 30h1v1h-1zM21 30h2v1h-2zM24 30h4v1h-4zM29 30h1v1h-1zM0 31h1v1h-1zM6 31h1v1h-1zM8 31h1v1h-1zM10 31h3v1h-3zM14 31h1v1h-1zM17 31h1v1h-1zM19 31h5v1h-5zM28 31h3v1h-3zM0 32h7v1h-7zM10 32h2v1h-2zM14 32h2v1h-2zM17 32h4v1h-4zM22 32h3v1h-3zM27 32h1v1h-1zM31 32h1v1h-1z";

// ข้อมูลตัวอย่าง 12 ครั้ง เรียงจากใหม่ → เก่า (ทุก 3 ชม.)
const MOCK_HISTORY = [
  { n: 75, p: 221, k: 215, moisture: 72.7, temperature: 33.2 },
  { n: 73, p: 219, k: 214, moisture: 71.9, temperature: 32.8 },
  { n: 74, p: 222, k: 212, moisture: 70.2, temperature: 32.1 },
  { n: 70, p: 215, k: 210, moisture: 68.8, temperature: 31.0 },
  { n: 68, p: 213, k: 211, moisture: 73.1, temperature: 30.4 },
  { n: 69, p: 216, k: 206, moisture: 75.4, temperature: 29.8 },
  { n: 64, p: 208, k: 204, moisture: 74.0, temperature: 30.9 },
  { n: 62, p: 205, k: 205, moisture: 69.5, temperature: 32.5 },
  { n: 63, p: 207, k: 199, moisture: 66.2, temperature: 34.0 },
  { n: 58, p: 200, k: 197, moisture: 64.8, temperature: 33.6 },
  { n: 57, p: 198, k: 196, moisture: 67.3, temperature: 32.2 },
  { n: 55, p: 196, k: 192, moisture: 70.1, temperature: 31.1 },
];

function MockNotice({ children }) {
  return (
    <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: TOKENS.warnSoft }}>
      <AlertTriangle size={15} color={TOKENS.warn} className="mt-0.5 shrink-0" />
      <div className="text-xs" style={{ color: TOKENS.warn }}>{children}</div>
    </div>
  );
}

function PageHeader({ title, goTo }) {
  return (
    <div className="px-5 pt-6 pb-5 flex items-center gap-3" style={{ background: TOKENS.soil }}>
      <button onClick={() => goTo("dashboard")}>
        <ChevronLeft size={20} color="#F5F0E6" />
      </button>
      <div>
        <div className="text-xs" style={{ color: "#C9BFA9" }}>แปลงทดสอบ · บ้านเหมืองกา</div>
        <div className="text-lg font-semibold text-white">{title}</div>
      </div>
    </div>
  );
}

function TrendChart({ values, color }) {
  const W = 320, H = 130, PX = 14, PY = 18;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    PX + (i * (W - PX * 2)) / (values.length - 1),
    PY + (1 - (v - min) / span) * (H - PY * 2),
  ]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={color} />)}
      <circle cx={last[0]} cy={last[1]} r="5" fill="#FBF8F2" stroke={color} strokeWidth="2.5" />
      <text x={PX} y="12" fontSize="10" fill={TOKENS.inkSoft}>สูงสุด {max}</text>
      <text x={PX} y={H - 4} fontSize="10" fill={TOKENS.inkSoft}>ต่ำสุด {min}</text>
    </svg>
  );
}

function HistoryPage({ goTo }) {
  const [sel, setSel] = useState("n");
  const now = Date.now();
  const rows = MOCK_HISTORY.map((r, i) => ({
    ...r,
    iso: new Date(now - i * 3 * 60 * 60 * 1000).toISOString(),
  }));
  const series = [...rows].reverse().map((r) => r[sel]); // เก่า → ใหม่
  const first = series[0], lastV = series[series.length - 1];
  const delta = lastV - first;
  const tabs = [
    { key: "n", label: "N" },
    { key: "p", label: "P" },
    { key: "k", label: "K" },
  ];
  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="ประวัติการวัด" goTo={goTo} />
      <div className="px-5 mt-4 flex flex-col gap-3 flex-1">
        <MockNotice>ข้อมูลตัวอย่างเพื่อสาธิต ยังไม่ใช่ค่าที่วัดจริง — ภายหลังจะดึงประวัติจริงจากฐานข้อมูล</MockNotice>

        <div className="flex gap-2">
          {tabs.map((t) => {
            const active = sel === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setSel(t.key)}
                className="flex-1 rounded-full py-2 text-sm font-semibold"
                style={{
                  background: active ? COLOR[t.key] : "#FBF8F2",
                  color: active ? "#fff" : TOKENS.inkSoft,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl p-4" style={{ background: "#FBF8F2", boxShadow: "0 4px 14px rgba(43,36,28,0.06)" }}>
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-xs" style={{ color: TOKENS.inkSoft }}>{LABEL[sel]} · 36 ชั่วโมงล่าสุด</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold" style={{ color: TOKENS.ink }}>{lastV}</span>
                <span className="text-sm" style={{ color: TOKENS.inkSoft }}>mg/kg</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-sm font-medium" style={{ color: delta >= 0 ? TOKENS.ok : TOKENS.bad }}>
              {delta >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              {delta >= 0 ? "+" : ""}{delta}
            </div>
          </div>
          <div className="mt-2">
            <TrendChart values={series} color={COLOR[sel]} />
          </div>
        </div>

        <div className="text-xs font-medium mt-1" style={{ color: TOKENS.inkSoft }}>บันทึกการวัด</div>
        <div className="flex flex-col gap-2 pb-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl px-3.5 py-3" style={{ background: "#FBF8F2" }}>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: TOKENS.inkSoft }}>{formatThaiDateTime(r.iso)}</span>
                {i === 0 && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: TOKENS.okSoft, color: TOKENS.ok }}>ล่าสุด</span>}
              </div>
              <div className="flex gap-4 mt-1.5">
                {["n", "p", "k"].map((c) => (
                  <div key={c}>
                    <span className="text-xs font-semibold" style={{ color: COLOR[c] }}>{c.toUpperCase()} </span>
                    <span className="text-sm font-semibold" style={{ color: TOKENS.ink }}>{r[c]}</span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] mt-1" style={{ color: TOKENS.inkSoft }}>
                ความชื้น {r.moisture}% · อุณหภูมิ {r.temperature}°C
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- หน้าข้อมูลพืช ---------- */

function RangeChip({ code, c }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5 text-center flex-1" style={{ background: TOKENS.paper }}>
      <div className="text-[10px] font-semibold" style={{ color: COLOR[code] }}>{code.toUpperCase()}</div>
      <div className="text-xs font-semibold" style={{ color: TOKENS.ink }}>{c.min}–{c.max}</div>
    </div>
  );
}

function PlantInfoCard({ plant, soil }) {
  const [compare, setCompare] = useState(false);
  const result = soil ? scorePlant(plant, soil) : null;
  const cr = plant.criteria;
  return (
    <div className="rounded-2xl p-4" style={{ background: "#FBF8F2", boxShadow: "0 4px 14px rgba(43,36,28,0.06)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold" style={{ color: TOKENS.ink }}>{plant.name_th}</div>
          <div className="text-xs" style={{ color: TOKENS.inkSoft }}>{plant.name_common}</div>
        </div>
        <span className="text-[10px] font-medium px-2 py-1 rounded-full" style={{ background: TOKENS.warnSoft, color: TOKENS.warn }}>ค่าตัวอย่าง</span>
      </div>
      <p className="text-xs mt-2" style={{ color: TOKENS.inkSoft }}>{plant.description}</p>

      <div className="text-[11px] mt-3 mb-1.5" style={{ color: TOKENS.inkSoft }}>ช่วงธาตุอาหารที่ต้องการ ({cr.n.unit})</div>
      <div className="flex gap-2">
        <RangeChip code="n" c={cr.n} />
        <RangeChip code="p" c={cr.p} />
        <RangeChip code="k" c={cr.k} />
      </div>

      <div className="text-[10px] mt-2.5" style={{ color: TOKENS.inkSoft }}>
        แหล่งข้อมูล: {cr.n.source} — {cr.n.reference}
      </div>

      {soil && (
        <>
          <button
            onClick={() => setCompare((v) => !v)}
            className="mt-3 w-full rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5"
            style={{ background: TOKENS.soil, color: "#F5F0E6" }}
          >
            <Sprout size={15} /> {compare ? "ซ่อนการเทียบกับดิน" : "อยากปลูกพืชนี้ — เทียบกับดินตอนนี้"}
          </button>
          {compare && (
            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${TOKENS.paper}` }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: TOKENS.inkSoft }}>ผลเทียบกับค่าดินล่าสุด</span>
                <VerdictBadge verdict={result.verdict} />
              </div>
              <NutrientLine code="n" evalResult={result.n} criterion={cr.n} />
              <NutrientLine code="p" evalResult={result.p} criterion={cr.p} />
              <NutrientLine code="k" evalResult={result.k} criterion={cr.k} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PlantsPage({ goTo, soil }) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const list = PLANTS.filter((p) => `${p.name_th} ${p.name_common}`.toLowerCase().includes(term));
  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="ข้อมูลพืช" goTo={goTo} />
      <div className="px-5 mt-4 flex flex-col gap-3 flex-1">
        <MockNotice>ฐานข้อมูลพืชตอนนี้มีเพียง {PLANTS.length} ชนิดและเป็นค่าตัวอย่าง — รอข้อมูลที่ตรวจสอบแล้วจากกรมพัฒนาที่ดิน (LDD) หรือแหล่งทางการอื่น</MockNotice>

        <div className="rounded-xl px-3 py-2.5 flex items-center gap-2" style={{ background: "#FBF8F2" }}>
          <Search size={16} color={TOKENS.inkSoft} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาพืช เช่น ข้าวโพด"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: TOKENS.ink }}
          />
        </div>

        {list.length === 0 ? (
          <div className="text-center text-sm py-8" style={{ color: TOKENS.inkSoft }}>ไม่พบพืชที่ค้นหา</div>
        ) : (
          list.map((p) => <PlantInfoCard key={p.name_th} plant={p} soil={soil} />)
        )}
        <div className="pb-3" />
      </div>
    </div>
  );
}

/* ---------- หน้า QR Code ---------- */

function QrPage({ goTo }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SITE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      /* คัดลอกไม่ได้ในบางเบราว์เซอร์ — ไม่ต้องทำอะไร */
    }
  };
  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="QR Code" goTo={goTo} />
      <div className="px-5 mt-5 flex flex-col items-center gap-4 flex-1">
        <div className="rounded-2xl p-5 w-full flex flex-col items-center" style={{ background: "#FBF8F2", boxShadow: "0 4px 14px rgba(43,36,28,0.06)" }}>
          <div className="text-base font-semibold" style={{ color: TOKENS.ink }}>NPK Soil Sensor</div>
          <div className="text-xs mb-3" style={{ color: TOKENS.inkSoft }}>สแกนเพื่อดูข้อมูลดินแบบเรียลไทม์</div>
          <svg viewBox={`-4 -4 ${QR_SIZE + 8} ${QR_SIZE + 8}`} className="w-56 h-56 rounded-lg" style={{ background: "#FBF8F2" }}>
            <path d={QR_PATH} fill={TOKENS.ink} shapeRendering="crispEdges" />
          </svg>
          <div className="text-[11px] mt-3 break-all text-center" style={{ color: TOKENS.inkSoft }}>{SITE_URL}</div>
          <div className="text-xs mt-1 font-medium" style={{ color: TOKENS.ink }}>NPK-001 · แปลงทดสอบ บ้านเหมืองกา</div>
        </div>

        <button
          onClick={copy}
          className="w-full rounded-2xl py-3.5 flex items-center justify-center gap-2 text-sm font-medium"
          style={{ background: TOKENS.soil, color: "#F5F0E6" }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "คัดลอกลิงก์แล้ว" : "คัดลอกลิงก์เว็บ"}
        </button>
        <div className="text-xs text-center px-4" style={{ color: TOKENS.inkSoft }}>
          พิมพ์ QR นี้ติดบนตัวเครื่อง เกษตรกรสแกนด้วยกล้องมือถือเพื่อเปิดหน้าเว็บนี้ได้ทันที
        </div>
      </div>
    </div>
  );
}


/* ---------- แอปหลัก ---------- */

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [status, setStatus] = useState("loading"); // loading | success | empty | error
  const [soil, setSoil] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    getLatestSoilReading(DEVICE_ID)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setStatus("empty");
        } else {
          setSoil(row);
          setStatus("success");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err.message || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ");
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, []);

  const navBar = (
    <div className="flex items-stretch border-t px-1 pb-1 pt-1 sticky bottom-0" style={{ background: "#FBF8F2", borderColor: TOKENS.paperDeep }}>
      <NavItem icon={BarChart3} label="หน้าหลัก" active={page === "dashboard"} onClick={() => setPage("dashboard")} />
      <NavItem icon={Leaf} label="แนะนำพืช" active={page === "recommend"} onClick={() => setPage("recommend")} />
      <NavItem icon={History} label="ประวัติ" active={page === "history"} onClick={() => setPage("history")} />
      <NavItem icon={Book} label="ข้อมูลพืช" active={page === "plants"} onClick={() => setPage("plants")} />
      <NavItem icon={QrCode} label="QR" active={page === "qr"} onClick={() => setPage("qr")} />
    </div>
  );

  let body;
  if (page === "history") body = <HistoryPage goTo={setPage} />;
  else if (page === "plants") body = <PlantsPage goTo={setPage} soil={soil} />;
  else if (page === "qr") body = <QrPage goTo={setPage} />;
  else if (status === "loading") {
    body = <StatusScreen icon={Loader2} tone="loading" title="กำลังโหลดข้อมูล..." detail="ดึงค่าล่าสุดจาก Supabase" />;
  } else if (status === "error") {
    body = <StatusScreen icon={AlertCircle} tone="error" title="โหลดข้อมูลไม่สำเร็จ" detail={errorMsg} />;
  } else if (status === "empty") {
    body = <StatusScreen icon={Inbox} tone="empty" title="ยังไม่มีข้อมูล" detail={`ยังไม่พบค่าที่วัดได้จากเครื่อง ${DEVICE_ID} เลย รอ ESP32 ส่งข้อมูลเข้ามาก่อน`} />;
  } else if (page === "recommend") {
    body = <RecommendPage goTo={setPage} soil={soil} />;
  } else {
    body = <DashboardPage goTo={setPage} soil={soil} />;
  }

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ background: TOKENS.paper, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      {body}
      {navBar}
    </div>
  );
}
