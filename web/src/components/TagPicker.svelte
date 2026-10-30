<script lang="ts">
  export let value = "";
  export let suggestions: string[] = [];
  let input = "";
  $: values = [
    ...new Set(
      value
        .split(/[,，]/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  function add(text: string) {
    const next = text.trim();
    if (next && !values.includes(next)) value = [...values, next].join(", ");
    input = "";
  }
</script>

<div class="tag-picker">
  <div class="tags">
    {#each values as tag}<span
        >{tag}<button
          type="button"
          aria-label={`移除标签${tag}`}
          on:click={() => (value = values.filter((v) => v !== tag).join(", "))}
          >×</button
        ></span
      >{/each}
  </div>
  <div class="tag-entry">
    <input
      aria-label="添加标签"
      bind:value={input}
      placeholder="输入标签后回车"
      on:keydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          add(input);
        }
      }}
    /><button type="button" disabled={!input.trim()} on:click={() => add(input)}
      >添加</button
    >
  </div>
  {#if suggestions.length}<div class="suggested">
      {#each suggestions
        .filter((s) => !values.includes(s))
        .slice(0, 10) as tag}<button type="button" on:click={() => add(tag)}
          >＋ {tag}</button
        >{/each}
    </div>{/if}
</div>

<style>
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 9px;
  }
  .tags span {
    display: inline-flex;
    align-items: center;
    background: #eff2fc;
    border: 1px solid #e4e8f5;
    border-radius: 5px;
    padding: 4px 5px 4px 8px;
    font-size: 10px;
    color: #8795b7;
    gap: 5px;
  }
  .tags button {
    border: 0;
    padding: 0 3px;
    background: none;
    font-size: 12px;
    color: #abb4ce;
  }
  .tag-entry {
    display: flex;
    gap: 6px;
  }
  .tag-entry input {
    min-width: 0;
    flex: 1;
    font-size: 11px;
  }
  .tag-entry button {
    font-size: 10px;
    padding: 8px 10px;
  }
  .suggested {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .suggested button {
    border: 0;
    background: #f7f8fc;
    color: #a3adc3;
    font-size: 9px;
    padding: 4px 7px;
  }
</style>
