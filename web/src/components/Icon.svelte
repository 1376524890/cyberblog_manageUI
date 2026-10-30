<script lang="ts">
 export let name = 'article';
 export let size = 20;
 const paths:Record<string,string> = {
 dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 article:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6',
 activity:'M3 12h4l3-8 4 16 3-8h4', users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 pages:'M8 3h13v15H8z M3 8v13h13', series:'M3 4h7v7H3z M14 4h7v7h-7z M3 15h7v7H3z M14 15h7v7h-7z',
 publish:'M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5', arrow:'M7 17 17 7 M7 7h10v10', plus:'M12 5v14 M5 12h14', logout:'M9 3H4v18h5 M10 12h11 M17 8l4 4-4 4', search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', check:'M5 12l4 4L19 6', code:'m8 5-7 7 7 7 M16 5l7 7-7 7 M14 3l-4 18', clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.article}/></svg>
