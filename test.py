from langchain_openai import ChatOpenAI

model = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0
)

response = model.invoke("Explique le Machine Learning simplement")

print(response.content)