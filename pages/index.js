import dynamic from "next/dynamic";

const SportAI = dynamic(() => import("../SportAI"), { ssr: false });

export default function Home() {
  return <SportAI />;
}
