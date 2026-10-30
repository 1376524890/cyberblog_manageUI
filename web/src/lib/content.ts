export const collections = {
  posts: {
    label: "文章管理",
    singular: "文章",
    hint: "把探索与经验，写成值得分享的文章。",
    icon: "article",
  },
  dynamic: {
    label: "社团动态",
    singular: "动态",
    hint: "记录社团的每一次新鲜事。",
    icon: "activity",
  },
  projects: {
    label: "成员介绍",
    singular: "成员",
    hint: "让每一位探索者，都有自己的位置。",
    icon: "users",
  },
  spec: {
    label: "独立页面",
    singular: "页面",
    hint: "维护关于我们等独立内容页面。",
    icon: "pages",
  },
};
export type Collection = keyof typeof collections;
export const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
export interface Item {
  slug: string;
  title: string;
  published: string | null;
  description: string;
  category: string | null;
  tags: string[];
  series: string;
  seriesOrder: number | null;
  draft: boolean;
  pinned: boolean;
  passwordProtected: boolean;
  wordCount: number;
  status?: string;
  order?: number;
  linkCount?: number;
  image?: string;
  location?: string;
}
