import { useState, useEffect } from "react";
import {
  Wifi, WifiOff, Clock, Sprout, Leaf, BarChart3, History, Book, QrCode,
  ChevronLeft, CheckCircle2, AlertTriangle, XCircle, Loader2, AlertCircle, Inbox,
  Droplets, Thermometer, Zap, FlaskConical,
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

/* ---------- หน้าที่ยังไม่ได้ทำ (placeholder) ---------- */

function ComingSoonPage({ title }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8 text-center">
      <div className="text-lg font-semibold" style={{ color: TOKENS.ink }}>{title}</div>
      <div className="text-sm" style={{ color: TOKENS.inkSoft }}>หน้านี้ยังไม่ได้สร้าง — กำลังทำต่อให้เร็ว ๆ นี้</div>
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
  if (page === "history") body = <ComingSoonPage title="ประวัติการวัด" />;
  else if (page === "plants") body = <ComingSoonPage title="ข้อมูลพืช" />;
  else if (page === "qr") body = <ComingSoonPage title="QR Code" />;
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
            
