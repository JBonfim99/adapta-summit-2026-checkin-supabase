import { useFormContext } from 'react-hook-form'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface FormInputProps {
  name: string
  label: string
  placeholder?: string
  type?: 'text' | 'email' | 'textarea' | 'select'
  options?: string[]
}

export function FormInput({ name, label, placeholder, type = 'text', options }: FormInputProps) {
  const { control } = useFormContext()

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-foreground">{label}</FormLabel>
          <FormControl>
            {type === 'textarea' ? (
              <Textarea placeholder={placeholder} className="resize-none" {...field} />
            ) : type === 'select' ? (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder={placeholder} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {options?.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input type={type} placeholder={placeholder} className="bg-white" {...field} />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
