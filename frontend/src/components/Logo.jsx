function Logo() {
  return (
    <div className="inline-flex items-center" aria-label="TalentLens">
      <div className="relative flex h-11 items-center justify-center overflow-hidden rounded-2xl px-5 bg-slate-950 text-white shadow-[0_18px_45px_rgba(15,23,42,0.18)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(48,54,61,0.95),transparent_46%),linear-gradient(145deg,#2563eb_20%,#0f172a_92%)]" />

        <span className="relative whitespace-nowrap text-lg font-bold tracking-[-0.04em]">
          TalentLens
        </span>
      </div>
    </div>
  );
}

export default Logo;
